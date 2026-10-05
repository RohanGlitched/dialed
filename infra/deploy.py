"""Build and deploy Dialed to AWS in one command (no Docker or AWS CLI needed).

  python infra/deploy.py [--stack dialed] [--region us-east-1] [--skip-web] [--skip-seed]

Credentials come from the usual boto3 chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or a profile).
Steps:
  1. package the Lambda: Linux arm64 wheels for OpenCV 5 and NumPy + our code + the two text models
  2. upload it to a deploy bucket and create or update the CloudFormation stack
  3. build the static site and upload it under site/ in the stack's bucket
  4. seed the sample plant (first deploy only) and invalidate the CDN
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
PY = sys.executable


def sh(*cmd, cwd=None, env=None):
    print("$", " ".join(map(str, cmd)))
    subprocess.run(list(map(str, cmd)), cwd=cwd, env=env, check=True)


def package() -> Path:
    pkg = BUILD / "lambda"
    if pkg.exists():
        shutil.rmtree(pkg)
    pkg.mkdir(parents=True)
    sh(PY, "-m", "pip", "install", "--quiet", "--target", pkg, "--platform", "manylinux_2_28_aarch64", "--platform", "manylinux2014_aarch64",
       "--python-version", "3.12", "--only-binary=:all:", "--implementation", "cp", "-r", ROOT / "requirements.txt")
    for d in ("agent", "api", "vision", "models"):
        shutil.copytree(ROOT / d, pkg / d, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "calibrate.py", "evaluate.py", "synth.py"))
    # trim what Lambda never imports
    for junk in pkg.glob("**/tests"):
        shutil.rmtree(junk, ignore_errors=True)
    out = BUILD / "lambda.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in sorted(pkg.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(pkg))
    size = sum(f.stat().st_size for f in pkg.rglob("*") if f.is_file())
    print(f"lambda package: {out.stat().st_size / 1e6:.1f} MB zipped, {size / 1e6:.1f} MB unzipped (limit 250)")
    if size > 250e6:
        raise SystemExit("package too large for Lambda")
    return out


def ensure_bucket(s3, name: str, region: str):
    try:
        s3.head_bucket(Bucket=name)
    except ClientError:
        kw = {} if region == "us-east-1" else {"CreateBucketConfiguration": {"LocationConstraint": region}}
        s3.create_bucket(Bucket=name, **kw)
        s3.put_public_access_block(Bucket=name, PublicAccessBlockConfiguration={k: True for k in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")})


def stack_outputs(cf, stack: str) -> dict:
    s = cf.describe_stacks(StackName=stack)["Stacks"][0]
    return {o["OutputKey"]: o["OutputValue"] for o in s.get("Outputs", [])}


def deploy_stack(cf, stack: str, params: dict) -> bool:
    body = (ROOT / "infra" / "template.yaml").read_text()
    p = [{"ParameterKey": k, "ParameterValue": v} for k, v in params.items()]
    try:
        cf.describe_stacks(StackName=stack)
        exists = True
    except ClientError:
        exists = False
    try:
        if exists:
            cf.update_stack(StackName=stack, TemplateBody=body, Parameters=p, Capabilities=["CAPABILITY_IAM"])
            waiter = cf.get_waiter("stack_update_complete")
        else:
            cf.create_stack(StackName=stack, TemplateBody=body, Parameters=p, Capabilities=["CAPABILITY_IAM"], OnFailure="ROLLBACK")
            waiter = cf.get_waiter("stack_create_complete")
    except ClientError as e:
        if "No updates are to be performed" in str(e):
            print("stack unchanged")
            return exists
        raise
    print(f"waiting for {stack} (CloudFront can take 5-15 minutes on first deploy)…")
    waiter.wait(StackName=stack, WaiterConfig={"Delay": 15, "MaxAttempts": 160})
    return not exists


def build_web() -> Path:
    web = ROOT / "web"
    env = {**os.environ, "NEXT_PUBLIC_API_BASE": "", "NEXT_DIST_DIR": ".next-build"}
    npm = "npm.cmd" if os.name == "nt" else "npm"
    sh(npm, "run", "build", cwd=web, env=env)
    return web / "out"


def upload_site(s3, bucket: str, out: Path):
    n = 0
    for f in sorted(out.rglob("*")):
        if not f.is_file():
            continue
        key = "site/" + f.relative_to(out).as_posix()
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if f.suffix == ".js":
            ctype = "text/javascript"
        immutable = "/_next/static/" in key or key.startswith("site/vendor/")
        cache = "public, max-age=31536000, immutable" if immutable else "public, max-age=60, must-revalidate"
        s3.upload_file(str(f), bucket, key, ExtraArgs={"ContentType": ctype, "CacheControl": cache})
        n += 1
    print(f"uploaded {n} site files")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stack", default="dialed")
    ap.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    ap.add_argument("--skip-web", action="store_true")
    ap.add_argument("--skip-seed", action="store_true")
    ap.add_argument("--llm", default="bedrock,nebius")
    a = ap.parse_args()
    os.environ["AWS_REGION"] = a.region
    sess = boto3.Session(region_name=a.region)
    account = sess.client("sts").get_caller_identity()["Account"]
    s3, cf = sess.client("s3"), sess.client("cloudformation")

    zip_path = package()
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()[:12]
    code_bucket = f"{a.stack}-deploy-{account}-{a.region}"
    ensure_bucket(s3, code_bucket, a.region)
    code_key = f"lambda/{digest}.zip"
    s3.upload_file(str(zip_path), code_bucket, code_key)
    print(f"uploaded s3://{code_bucket}/{code_key}")

    created = deploy_stack(cf, a.stack, {"CodeBucket": code_bucket, "CodeKey": code_key, "LlmOrder": a.llm, "NebiusApiKey": os.environ.get("NEBIUS_API_KEY", "").strip().strip('"')})
    out = stack_outputs(cf, a.stack)
    print(json.dumps(out, indent=1))

    if not a.skip_web:
        upload_site(s3, out["Bucket"], build_web())
    if created and not a.skip_seed:
        env = {**os.environ, "DIALED_TABLE": out["Table"], "DIALED_BUCKET": out["Bucket"]}
        sh(PY, ROOT / "scripts" / "seed.py", env=env)
    sess.client("cloudfront").create_invalidation(
        DistributionId=out["DistributionId"],
        InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/*"]}, "CallerReference": str(time.time())},
    )
    print("live at", out["SiteUrl"])


if __name__ == "__main__":
    main()
