import path from "node:path";
import type { NextConfig } from "next";

// Static export: the site is plain files on S3 behind CloudFront; /api/* goes to the Lambda Function URL.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  outputFileTracingRoot: path.join(import.meta.dirname),
};

export default config;
