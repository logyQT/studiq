import { Avatar, Style } from '@dicebear/core';
import definition from '@dicebear/styles/initials.json' with { type: 'json' };

const style = new Style(definition);

export async function GET(_request: Request, { params }: { params: Promise<{ seed: string }> }) {
  const { seed } = await params;

  const svg = new Avatar(style, { seed, size: 128, borderRadius: 6 }).toString();

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
