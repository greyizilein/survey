import { useEffect, useRef, useState } from "react";

interface AnimatedRingProps {
  size?: number;
  strokeWidth?: number;
  percent: number;
  color?: string;
  bgColor?: string;
  className?: string;
  children?: React.ReactNode;
}

export function AnimatedRing({
  size = 60,
  strokeWidth = 5,
  percent,
  color = "hsl(var(--primary))",
  bgColor = "hsl(var(--border))",
  className = "",
  children,
}: AnimatedRingProps) {
  const [animPercent, setAnimPercent] = useState(0);
  const ref = useRef<SVGCircleElement>(null);
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;

  useEffect(() => {
    const t = setTimeout(() => setAnimPercent(percent), 80);
    return () => clearTimeout(t);
  }, [percent]);

  const offset = circ - (animPercent / 100) * circ;

  return (
    <svg width={size} height={size} className={className}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bgColor} strokeWidth={strokeWidth} />
      <circle
        ref={ref}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 1s ease-out" }}
      />
      {children}
    </svg>
  );
}
