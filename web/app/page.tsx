import { Clipboard } from "@/components/home/Clipboard";
import { Hero } from "@/components/home/Hero";
import { HowItReads } from "@/components/home/HowItReads";
import { LogicSheet } from "@/components/home/LogicSheet";
import { Accuracy, Architecture, CoachPreview, Limits, RecorderPreview, RoundPreview } from "@/components/home/Sections";
import { TryIt } from "@/components/home/TryIt";

export default function Home() {
  return (
    <>
      <Hero />
      <Clipboard />
      <TryIt />
      <HowItReads />
      <LogicSheet />
      <CoachPreview />
      <RoundPreview />
      <RecorderPreview />
      <Accuracy />
      <Architecture />
      <Limits />
    </>
  );
}
