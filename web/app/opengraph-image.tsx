import { ImageResponse } from 'next/og'
import { readFileSync } from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const alt = 'filmprint'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  const printSvg = readFileSync(path.join(process.cwd(), 'public/print.svg'), 'utf8')
    .replace(/fill="#000000"/g, 'fill="#fbbf24"')
  const printSrc = `data:image/svg+xml;base64,${Buffer.from(printSvg).toString('base64')}`

  const wordmarkData = readFileSync(path.join(process.cwd(), 'public/text_only.svg'))
  const wordmarkSrc = `data:image/svg+xml;base64,${wordmarkData.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#0a0a0a',
          gap: 16,
        }}
      >
        {/* print.svg is 1200x1200 (square) — h-40 equivalent scaled up */}
        <img src={printSrc} width={240} height={240} />
        {/* text_only.svg viewBox ~2660x596 (aspect ~4.46:1) — h-14 equivalent scaled up */}
        <img src={wordmarkSrc} width={375} height={84} />
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
