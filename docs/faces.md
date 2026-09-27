---
title: FaceSpec vector art
description: Safe declarative face and board artwork for Digipology pieces.
---

# FaceSpec vector art

FaceSpec is an inline, safe-by-construction drawing format for piece faces, card backs, tokens, tiles, and boards. It has no SVG/HTML source, URLs, images, scripts, event handlers, or external references. The browser validates it before using the Canvas2D renderer; the editor preview uses an escaping SVG serializer.

Coordinates use a `0..1000` by `0..1000` view box. The renderer stretches that logical square to the piece's `w:d` aspect ratio. A spec has a `background` fill and an `elements` array:

```json
{
  "background": "#f7e6a1",
  "elements": [
    { "type": "icon", "name": "wheat", "x": 500, "y": 480, "size": 620, "fill": "#8a641e" },
    { "type": "text", "x": 500, "y": 900, "text": "WHEAT", "font": "sans", "size": 84, "weight": 800, "align": "center", "fill": "#3e3015" }
  ]
}
```

## Fills and paint

A fill is `#RRGGBB` or a linear gradient:

```json
{"type":"linear-gradient","x1":0,"y1":0,"x2":1000,"y2":1000,"stops":[{"offset":0,"color":"#173d65"},{"offset":1,"color":"#071727"}]}
```

Paintable elements accept optional `fill`, `stroke`, `strokeWidth` (`0..100`), and `opacity` (`0..1`). Gradients contain 2–16 stops with nondecreasing offsets.

## Elements

| Type | Required fields | Notes |
| --- | --- | --- |
| `rect` | `x`, `y`, `w`, `h` | Optional corner radius `r`. |
| `circle` | `cx`, `cy`, `r` | Radius is non-negative. |
| `ellipse` | `cx`, `cy`, `rx`, `ry` | Radii are non-negative. |
| `polygon` | `points: [{x,y}, ...]` | 3–500 points. |
| `path` | `d` | Uppercase `M`, `L`, `Q`, `C`, `A`, and `Z` only; numeric parameters only. |
| `line` | `x1`, `y1`, `x2`, `y2` | Uses stroke paint. |
| `text` | `x`, `y`, `text`, `font`, `size` | Fonts `sans`, `serif`, `mono`; weights 400/600/700/800; align left/center/right; optional degree rotation. Text is escaped. |
| `icon` | `name`, `x`, `y`, `size` | Optional degree rotation. |
| `group` | `elements` | Optional `translate`, `rotate`, `scale`, and `opacity`; groups may nest. |

Built-in icons are `wheat`, `brick`, `ore`, `wool`, `lumber`, `desert`, `coin`, `crown`, `sword`, `shield`, `anchor`, `star`, `skull`, `eye`, `scroll`, `heart`, `tower`, `horse`, `bishop-mitre`, `king-cross`, `queen-crown`, `pawn`, `flag`, `hand`, `gavel`, `road`, `house`, `city`, `ship`, and `pip-1` through `pip-6`.

Normal pieces allow at most 300 total elements, including group children. A `board` definition allows 2,500. Paths are limited to 8,192 characters and text to 200 characters. Finite drawing numbers stay within ±10,000, plus tighter field-specific bounds. Unknown keys and non-finite numbers are rejected. A validated spec has a canonical `face-v1-…` hash used by both adapters for texture caching.

## Examples

Hex resource tile:

```json
{"background":"#e8c765","elements":[{"type":"polygon","points":[{"x":500,"y":30},{"x":920,"y":260},{"x":920,"y":740},{"x":500,"y":970},{"x":80,"y":740},{"x":80,"y":260}],"fill":"#f3db85","stroke":"#77551b","strokeWidth":24},{"type":"icon","name":"wheat","x":500,"y":500,"size":560,"fill":"#8b681b"}]}
```

Playing card:

```json
{"background":"#fffdf5","elements":[{"type":"text","x":90,"y":150,"text":"A","font":"serif","size":130,"weight":800,"fill":"#b52828"},{"type":"icon","name":"heart","x":500,"y":520,"size":430,"fill":"#b52828"},{"type":"text","x":910,"y":900,"text":"A","font":"serif","size":130,"weight":800,"align":"right","rotation":180,"fill":"#b52828"}]}
```

Chess piece top marker:

```json
{"background":"#f0eadc","elements":[{"type":"circle","cx":500,"cy":500,"r":390,"fill":"#202421","stroke":"#c7a95b","strokeWidth":28},{"type":"icon","name":"queen-crown","x":500,"y":500,"size":560,"fill":"#f0eadc"}]}
```

Board with territories:

```json
{"background":{"type":"linear-gradient","x1":0,"y1":0,"x2":1000,"y2":1000,"stops":[{"offset":0,"color":"#183f52"},{"offset":1,"color":"#0b202d"}]},"elements":[{"type":"path","d":"M70 180 L350 90 L470 310 L260 470 L80 390 Z","fill":"#8ba35e","stroke":"#f2e6c4","strokeWidth":12},{"type":"path","d":"M500 160 L890 110 L930 430 L650 500 L470 310 Z","fill":"#b37b55","stroke":"#f2e6c4","strokeWidth":12},{"type":"path","d":"M260 470 L650 500 L850 850 L340 920 L90 700 Z","fill":"#6f8e9e","stroke":"#f2e6c4","strokeWidth":12},{"type":"icon","name":"tower","x":280,"y":270,"size":120,"fill":"#27352a"},{"type":"icon","name":"ship","x":750,"y":650,"size":150,"fill":"#f2e6c4"}]}
```
