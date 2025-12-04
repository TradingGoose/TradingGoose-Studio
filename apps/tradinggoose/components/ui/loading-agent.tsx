'use client'

export interface LoadingAgentProps {
  /**
   * Size of the loading agent
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
}

export function LoadingAgent({ size = 'md' }: LoadingAgentProps) {
  const pathLength = 120

  const sizes = {
    sm: { width: 16, height: 18 },
    md: { width: 21, height: 24 },
    lg: { width: 30, height: 34 },
  }

  const { width, height } = sizes[size]

  return (
    <svg
      width={width}
      height={height}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <g stroke="var(--primary)" strokeWidth="1"><circle cx="12" cy="12" r="9.5" fill="none" strokeLinecap="round" strokeWidth="3"><animate attributeName="stroke-dasharray" calcMode="spline" dur="1.125s" keySplines="0.42,0,0.58,1;0.42,0,0.58,1;0.42,0,0.58,1" keyTimes="0;0.475;0.95;1" repeatCount="indefinite" values="0 150;42 150;42 150;42 150" /><animate attributeName="stroke-dashoffset" calcMode="spline" dur="1.125s" keySplines="0.42,0,0.58,1;0.42,0,0.58,1;0.42,0,0.58,1" keyTimes="0;0.475;0.95;1" repeatCount="indefinite" values="0;-16;-59;-59" /></circle><animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" /></g>
      <style>
        {`
          @keyframes dashLoop {
            0% {
              stroke-dashoffset: ${pathLength};
            }
            50% {
              stroke-dashoffset: 0;
            }
            100% {
              stroke-dashoffset: ${pathLength};
            }
          }
        `}
      </style>
    </svg>
  )
}
