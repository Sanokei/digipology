export interface BuiltinCover {
  contentType: "image/svg+xml";
  body: string;
  version: number;
}

const firstDeal = `<svg xmlns="http://www.w3.org/2000/svg" width="336" height="504" viewBox="0 0 336 504" role="img" aria-labelledby="title desc">
<title id="title">First Deal</title><desc id="desc">A restrained fan of playing cards on a dark table.</desc>
<rect width="336" height="504" fill="#0b0b0f"/><rect x="18" y="18" width="300" height="468" rx="18" fill="#16161c" stroke="#26262e" stroke-width="2"/>
<path d="M44 100h248" stroke="#f3a53b" stroke-width="3"/><text x="44" y="76" fill="#f3a53b" font-family="Inter,Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="3">TABLE SERIES</text>
<g transform="translate(168 256)">
<rect x="-91" y="-88" width="126" height="184" rx="10" fill="#111116" stroke="#a1a1aa" stroke-width="2" transform="rotate(-13)"/>
<rect x="-48" y="-103" width="126" height="184" rx="10" fill="#f3f3f5" stroke="#f3a53b" stroke-width="3" transform="rotate(8)"/>
<path d="M-4-58l13 19 13-19 13 19-13 19-13-19-13 19-13-19z" fill="#f3a53b" transform="rotate(8)"/>
<circle cx="-57" cy="25" r="25" fill="none" stroke="#f3a53b" stroke-width="3"/><path d="M-70 25h26M-57 12v26" stroke="#f3a53b" stroke-width="3"/>
</g>
<text x="44" y="414" fill="#f3f3f5" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="900">FIRST DEAL</text><text x="44" y="442" fill="#a1a1aa" font-family="Inter,Arial,sans-serif" font-size="13">SHUFFLE · DRAW · PLAY</text>
</svg>`;

const diceDash = `<svg xmlns="http://www.w3.org/2000/svg" width="336" height="504" viewBox="0 0 336 504" role="img" aria-labelledby="title desc">
<title id="title">Dice Dash</title><desc id="desc">Two geometric dice crossing an amber finish line.</desc>
<rect width="336" height="504" fill="#0b0b0f"/><rect x="18" y="18" width="300" height="468" rx="18" fill="#16161c" stroke="#26262e" stroke-width="2"/>
<text x="44" y="76" fill="#f3a53b" font-family="Inter,Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="3">RACE NIGHT</text><path d="M44 100h248" stroke="#f3a53b" stroke-width="3"/>
<g transform="translate(168 245) rotate(-8)">
<path d="M-118 62h236" stroke="#a1a1aa" stroke-width="2" stroke-dasharray="9 8"/><path d="M-118 76h236" stroke="#f3a53b" stroke-width="5"/>
<rect x="-84" y="-73" width="112" height="112" rx="18" fill="#f3f3f5" stroke="#f3a53b" stroke-width="3"/><circle cx="-58" cy="-47" r="9" fill="#17130a"/><circle cx="2" cy="13" r="9" fill="#17130a"/><circle cx="-28" cy="-17" r="9" fill="#17130a"/>
<rect x="18" y="-25" width="102" height="102" rx="18" fill="#111116" stroke="#f3a53b" stroke-width="3"/><circle cx="44" cy="1" r="8" fill="#f3a53b"/><circle cx="94" cy="1" r="8" fill="#f3a53b"/><circle cx="44" cy="51" r="8" fill="#f3a53b"/><circle cx="94" cy="51" r="8" fill="#f3a53b"/>
</g>
<text x="44" y="414" fill="#f3f3f5" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="900">DICE DASH</text><text x="44" y="442" fill="#a1a1aa" font-family="Inter,Arial,sans-serif" font-size="13">ROLL · SCORE · RACE</text>
</svg>`;

const covers: Readonly<Record<string, BuiltinCover>> = Object.freeze({
  "first-deal": { contentType: "image/svg+xml", body: firstDeal, version: 1 },
  "dice-dash": { contentType: "image/svg+xml", body: diceDash, version: 1 },
});

export function getBuiltinCover(slug: string): BuiltinCover | null {
  return covers[slug] ?? null;
}
