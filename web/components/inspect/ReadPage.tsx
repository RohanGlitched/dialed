"use client";
import { useState } from "react";
import { CameraCoach } from "@/components/camera/CameraCoach";
import { Reader } from "./Reader";
import { Tips } from "./Tips";
import s from "./page.module.css";

export function ReadPage() {
  const [camera, setCamera] = useState(false);
  const [shot, setShot] = useState<{ photo: string; label: string } | null>(null);
  return (
    <>
      <section className={`wrap ${s.head}`}>
        <p className="cell">Sheet 02</p>
        <h1 className={`display ${s.h1}`}>Read a gauge</h1>
        <p className="lede">
          Use any photo of an analog pressure or temperature gauge. The reader runs on AWS Lambda with OpenCV 5 and shows you every stage: where it found the dial, how it straightened it, which numbers it read, and why it is or isn&apos;t sure.
        </p>
      </section>
      <section className="wrap" style={{ marginTop: 48 }}>
        {camera && (
          <div style={{ marginBottom: 48 }}>
            <CameraCoach
              onClose={() => setCamera(false)}
              onShot={(photo) => {
                setCamera(false);
                setShot({ photo, label: "Your camera photo" });
              }}
            />
          </div>
        )}
        <Reader onCamera={camera ? undefined : () => setCamera(true)} incoming={shot} />
      </section>
      <Tips />
    </>
  );
}
