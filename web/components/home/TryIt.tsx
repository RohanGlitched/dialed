import { Reader } from "@/components/inspect/Reader";

export function TryIt() {
  return (
    <section className="wrap section" aria-labelledby="try-h">
      <div className="section-head">
        <h2 id="try-h" className="h2">Try it on a gauge</h2>
        <p className="lede">Drop a photo of any analog pressure or temperature gauge, or pick a sample. It&apos;s read live on AWS Lambda, and you can step through every stage of what OpenCV saw.</p>
      </div>
      <Reader compact />
    </section>
  );
}
