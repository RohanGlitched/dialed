/** The wordmark's dial: a bezel, a needle in signal red, a hub. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="13" fill="none" stroke="currentColor" strokeWidth="2.4" />
      {[-135, -90, -45, 0, 45, 90, 135].map((a) => {
        const r = (a * Math.PI) / 180;
        return <line key={a} x1={15 + 10.4 * Math.sin(r)} y1={15 - 10.4 * Math.cos(r)} x2={15 + 8.6 * Math.sin(r)} y2={15 - 8.6 * Math.cos(r)} stroke="currentColor" strokeWidth="1.4" />;
      })}
      <path d="M15 15 L22.2 7.8" stroke="var(--needle)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="15" cy="15" r="2.6" fill="currentColor" />
    </svg>
  );
}
