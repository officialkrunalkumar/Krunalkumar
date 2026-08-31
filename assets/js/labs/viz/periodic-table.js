/* ==========================================================================
   periodic-table.js — all 118 elements, with what each one actually looks like.
   --------------------------------------------------------------------------
   Every periodic table on the web colours the tiles by category and stops
   there, which leaves you knowing that sulfur is a "reactive nonmetal" and
   still with no idea that it is a startling lemon yellow, or that bromine is
   one of only two elements that are liquid in a warm room, or that caesium is
   gold. This one draws the substance as well as the data.

   Four decisions worth spelling out, because they are the interesting bits:

   1. The appearance is DRAWN, not photographed. There is not a single licensed
      photograph in this repository and I am not going to hotlink one, so every
      swatch is procedural: CSS gradients for the small tile, an inline SVG with
      real gradients and an feTurbulence grain for the large one. Each element
      carries an explicit descriptor — a base colour, a phase, and a surface
      kind (lustrous metal, dull metal, liquid metal, crystal, powder, black
      lustre, glowing gas, unknown) — and the renderer builds the highlight,
      the shadow and the grain from that. A metal gets a specular sweep and a
      brushed grain; a gas gets a discharge glow in a tube; a liquid gets a
      meniscus and a vapour space. It will never be a photograph. It is meant
      to be recognisable, and honest about being a drawing.

   2. Shell diagrams are derived, not typed in. The electron configuration is
      stored once as a machine-readable string ("1s2 2s2 2p6 ..."), the
      noble-gas shorthand is computed by matching the previous noble gas as a
      prefix, and the Bohr shell occupancies are computed by summing each
      subshell into its principal quantum number. Three views of one fact, so
      they cannot drift apart. The configurations include the real anomalies —
      chromium, copper, palladium, platinum, the lanthanide and actinide
      irregularities — because rounding those off to the aufbau prediction
      would be teaching something false.

   3. Where a number is not known, it says unknown. Elements above fermium have
      never existed in weighable amounts; their melting points, densities and
      radii are predictions from relativistic quantum chemistry, not
      measurements, and several have no accepted prediction at all. Inventing a
      plausible-looking number for rutherfordium's density would make the page
      look more complete and be worse than useless. Those cells read "unknown"
      and the element is flagged as predicted.

   4. It is a group of buttons, not a role="grid". The lanthanides and actinides
      are pulled out into their own rows, so the visual grid is not a rectangle
      of rows and the DOM has no row containers to hang role="row" on. Faking
      them with display:contents is exactly the trick that has historically
      dropped elements out of the accessibility tree in Safari. So this is an
      honest labelled group of buttons with a roving tabindex and arrow-key
      movement computed from the real (period, group) coordinates, and every
      button carries a full spoken label.

   Nothing here opens a network connection, loads a font, or fetches an image.
   The whole table is this one file.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* ======================================================================
     STYLE
     The visualiser modules inject their own scoped stylesheet rather than
     growing the shared labs.css — see processor.js and cpu.js. style-src
     allows 'unsafe-inline', so a <style> element is permitted; nothing here
     is a script.
     ====================================================================== */
  var CSS = [
    '#ptable .pt-wrap{display:flex;flex-direction:column;min-height:0;background:#050912;color:#dbe5f2;',
    'font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}',
    '#ptable .pt-scroll{overflow:auto;padding:14px;}',
    '#ptable .pt-grid{display:grid;grid-template-columns:repeat(18,minmax(0,1fr));gap:3px;min-width:900px;}',
    '#ptable .pt-frow{grid-column:1/-1;height:10px;}',

    '#ptable .pt-cell{position:relative;display:flex;flex-direction:column;justify-content:center;',
    'align-items:center;aspect-ratio:1/1;min-height:38px;padding:2px 1px;border:1px solid rgba(255,255,255,.11);',
    'border-radius:5px;background:#131a26;color:#eef3fa;font:inherit;cursor:pointer;overflow:hidden;',
    'text-align:center;transition:transform .12s ease,box-shadow .12s ease,opacity .15s ease;}',
    '#ptable .pt-cell:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.55);z-index:2;}',
    '#ptable .pt-cell:focus-visible{outline:2px solid #7dd3fc;outline-offset:1px;z-index:3;}',
    '#ptable .pt-cell.is-on{box-shadow:0 0 0 2px #7dd3fc,0 8px 20px rgba(0,0,0,.6);z-index:3;}',
    '#ptable .pt-cell.is-off{opacity:.16;}',
    '#ptable .pt-z{position:absolute;top:2px;left:4px;font-size:9px;line-height:1;opacity:.72;}',
    '#ptable .pt-sym{font-size:17px;font-weight:700;line-height:1.05;}',
    '#ptable .pt-nm{font-size:8px;line-height:1.2;opacity:.85;max-width:100%;overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap;}',
    '#ptable .pt-sw{position:absolute;left:0;right:0;bottom:0;height:6px;}',
    /* The scrim only earns its keep in appearance mode. A silvery metal tile
       is close to white, and white 8px labels on it are unreadable; a soft
       dark veil over the drawn surface keeps the number, symbol and name
       legible while the appearance still reads through. In the flat colour
       modes the tile is already dark, so the veil is switched off. */
    '#ptable .pt-scrim{position:absolute;inset:0;pointer-events:none;opacity:0;',
    'background:linear-gradient(180deg,rgba(3,6,12,.66),rgba(3,6,12,.2) 52%,rgba(3,6,12,.72));}',
    '#ptable .pt-grid.mode-appearance .pt-scrim{opacity:1;}',
    '#ptable .pt-grid.mode-appearance .pt-sw{display:none;}',
    '#ptable .pt-cell .pt-z,#ptable .pt-cell .pt-sym,#ptable .pt-cell .pt-nm{position:relative;z-index:1;}',
    '#ptable .pt-mount{display:flex;flex-direction:column;min-height:0;}',

    '#ptable .pt-ph{display:flex;flex-direction:column;justify-content:center;align-items:center;',
    'aspect-ratio:1/1;min-height:38px;border:1px dashed rgba(255,255,255,.22);border-radius:5px;',
    'background:#0d1420;color:#93a4bd;font:inherit;font-size:9px;line-height:1.2;cursor:pointer;text-align:center;}',
    '#ptable .pt-ph:hover{border-color:rgba(125,211,252,.6);color:#cfe3f7;}',
    '#ptable .pt-ph:focus-visible{outline:2px solid #7dd3fc;outline-offset:1px;}',

    '#ptable .pt-legend{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px 12px;',
    'border-top:1px solid rgba(125,211,252,.14);background:#070c15;}',
    '#ptable .pt-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;',
    'border:1px solid rgba(255,255,255,.12);background:#101827;font-size:11.5px;color:#c6d3e4;}',
    '#ptable .pt-dot{width:11px;height:11px;border-radius:3px;flex:0 0 auto;}',
    '#ptable .pt-note{padding:0 14px 12px;margin:0;font-size:11.5px;line-height:1.6;color:#8ea0ba;background:#070c15;}',

    '#ptable .pt-panel{display:grid;grid-template-columns:minmax(0,290px) minmax(0,240px) minmax(0,1fr);',
    'gap:16px;padding:14px;border-top:1px solid rgba(125,211,252,.16);background:#080d17;}',
    '#ptable .pt-col{min-width:0;}',
    '#ptable .pt-head{display:flex;align-items:center;gap:12px;margin:0 0 10px;}',
    '#ptable .pt-badge{width:58px;height:58px;flex:0 0 auto;border-radius:9px;border:1px solid rgba(255,255,255,.16);',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden;}',
    '#ptable .pt-badge b{position:relative;z-index:1;font-size:22px;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,.9);}',
    '#ptable .pt-badge i{position:relative;z-index:1;font-size:10px;font-style:normal;opacity:.85;text-shadow:0 1px 3px rgba(0,0,0,.9);}',
    '#ptable .pt-title{min-width:0;}',
    '#ptable .pt-title h3{margin:0;font-size:19px;line-height:1.2;color:#f2f7fd;}',
    '#ptable .pt-title p{margin:2px 0 0;font-size:12px;color:#9db0c9;}',
    '#ptable .pt-svg{display:block;width:100%;height:auto;border-radius:9px;}',
    '#ptable .pt-look{margin:9px 0 0;font-size:12.5px;line-height:1.6;color:#b7c6da;}',
    '#ptable .pt-look b{color:#dfe9f6;font-weight:600;}',
    '#ptable .pt-shells{margin:8px 0 0;font-size:11.5px;line-height:1.6;color:#9db0c9;text-align:center;}',
    '#ptable .pt-sub{margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7d90ab;}',

    '#ptable .pt-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:2px 14px;margin:0;}',
    '#ptable .pt-facts > div{min-width:0;}',
    '#ptable .pt-facts dt{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#7d90ab;margin-top:8px;}',
    '#ptable .pt-facts dd{margin:1px 0 0;font-size:13px;color:#e2eaf5;}',
    '#ptable .pt-facts dd.q{color:#8ea0ba;font-style:italic;}',
    '#ptable .pt-cfg{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;word-break:break-word;}',
    '#ptable .pt-use{margin:12px 0 0;padding:10px 12px;border-radius:9px;background:#0d1524;',
    'border:1px solid rgba(125,211,252,.14);font-size:13px;line-height:1.65;color:#cfdcec;}',
    '#ptable .pt-flag{display:inline-block;margin:10px 0 0;padding:3px 9px;border-radius:999px;font-size:11px;',
    'background:#3a2a12;border:1px solid #8a6a2a;color:#f0d49a;}',

    '#ptable .pt-find{font:inherit;font-size:0.9rem;padding:0.4rem 0.7rem;color:var(--ink);',
    'background-color:var(--surf-1);border:1px solid rgb(var(--accent-rgb) / 0.3);border-radius:8px;min-width:12rem;}',
    '#ptable .pt-temp{font-family:"Cascadia Code","Fira Code",Consolas,Menlo,monospace;font-size:0.78rem;',
    'color:var(--accent-1);min-width:8.5rem;}',

    '#ptable.is-fullscreen .pt-mount{flex:1 1 auto;min-height:0;}',
    '#ptable.is-fullscreen .pt-wrap{flex:1 1 auto;min-height:0;}',
    '#ptable.is-fullscreen .pt-scroll{flex:1 1 auto;min-height:0;}',

    '@media (max-width:980px){#ptable .pt-panel{grid-template-columns:minmax(0,1fr);}}',
    '@media (prefers-reduced-motion:reduce){#ptable .pt-cell{transition:none;}',
    '#ptable .pt-cell:hover{transform:none;}}'
  ].join('');

  /* ======================================================================
     THE DATASET
     ----------------------------------------------------------------------
     Fields:
       z, sym, name        atomic number, symbol, name
       weight              standard atomic weight (IUPAC 2021, abridged).
                           Square brackets mark a mass number rather than a
                           weight — those elements have no stable isotope, so
                           there is nothing to average.
       cat                 category key (see CATS below)
       group, period       group is null across the f-block: IUPAC assigns no
                           group numbers to the lanthanides and actinides, and
                           which two of them belong in group 3 is still argued
                           over. Saying null is more honest than picking a side.
       block               s, p, d or f
       cfg                 full ground-state configuration, machine-readable.
                           Ordered f, d, s, p within each period block so that
                           the previous noble gas is always a literal prefix.
       en                  Pauling electronegativity, or null
       radius              empirical (Slater) atomic radius in pm, or null.
                           The noble gases have none: Slater's values come from
                           bond lengths and they do not form the bonds.
       ie                  first ionisation energy, kJ/mol, or null
       melt, boil          in kelvin, or null for unknown
       subl                true if it sublimes at 1 atm and never melts there
       density             display string, because gases are quoted in g/L and
                           condensed phases in g/cm3 and silently mixing the
                           two units would be a lie in the fourth decimal place
       year, by            discovery
       abundance           where it comes from, in a phrase
       ox                  common oxidation states
       use                 one plain sentence on what it is actually for
       predicted           true where the physical data is prediction, not
                           measurement (everything above fermium)
       look                appearance descriptor:
                             kind   metal | dullmetal | liquidmetal | gas |
                                    liquid | crystal | powder | graphite | unknown
                             colour base colour of the substance
                             glow   discharge or radioluminescence colour
                             desc   what you would see, in words
     ====================================================================== */

  var ELEMENTS = [
    { z: 1, sym: 'H', name: 'Hydrogen', weight: '1.008', cat: 'nonmetal', group: 1, period: 1, block: 's',
      cfg: '1s1', en: 2.20, radius: 25, ie: 1312.0, melt: 13.99, boil: 20.271,
      density: '0.08988 g/L at 0 °C', year: '1766', by: 'Henry Cavendish',
      abundance: 'About 0.15% of the crust by mass, but roughly nine out of every ten atoms in the universe.',
      ox: '+1, -1',
      use: 'Almost all of it goes into making ammonia for fertiliser and into refining crude oil; the rest is fuel-cell and rocket fuel.',
      look: { kind: 'gas', colour: '#cfe0f5', glow: '#ff5f8f', desc: 'Colourless, odourless gas. In a discharge tube it burns pink-magenta — the Balmer lines you see in every school spectroscope.' } },

    { z: 2, sym: 'He', name: 'Helium', weight: '4.0026', cat: 'noble', group: 18, period: 1, block: 's',
      cfg: '1s2', en: null, radius: null, ie: 2372.3, melt: null, boil: 4.222,
      density: '0.1786 g/L at 0 °C', year: '1868', by: 'Pierre Janssen and Norman Lockyer',
      abundance: '5.2 parts per million of the air; commercially it is separated out of natural gas.',
      ox: '0',
      use: 'Cooling superconducting magnets in MRI scanners, pressurising rocket fuel tanks, and lifting balloons — in that order of importance.',
      look: { kind: 'gas', colour: '#e8f0fb', glow: '#ffb27a', desc: 'Colourless gas. Its discharge is a warm peach-orange. It is the only element that does not freeze at atmospheric pressure, no matter how cold.' } },

    { z: 3, sym: 'Li', name: 'Lithium', weight: '6.94', cat: 'alkali', group: 1, period: 2, block: 's',
      cfg: '1s2 2s1', en: 0.98, radius: 145, ie: 520.2, melt: 453.65, boil: 1603,
      density: '0.534 g/cm³', year: '1817', by: 'Johan August Arfwedson',
      abundance: 'About 20 parts per million of the crust; mined from pegmatites and pumped from salt brines.',
      ox: '+1',
      use: 'Rechargeable batteries, by a wide margin; also heat-resistant glass, and lithium carbonate as a mood stabiliser.',
      look: { kind: 'metal', colour: '#d9dee4', glow: '#e8503c', desc: 'Silvery-white and soft enough to cut with a knife, but it tarnishes to a dull grey within seconds of meeting air. Its flame is crimson.' } },

    { z: 4, sym: 'Be', name: 'Beryllium', weight: '9.0122', cat: 'alkaline', group: 2, period: 2, block: 's',
      cfg: '1s2 2s2', en: 1.57, radius: 105, ie: 899.5, melt: 1560, boil: 2742,
      density: '1.85 g/cm³', year: '1798', by: 'Louis-Nicolas Vauquelin',
      abundance: 'About 2.8 parts per million of the crust, mostly as beryl.',
      ox: '+2',
      use: 'X-ray windows, because it is nearly transparent to X-rays, and copper-beryllium alloys for non-sparking tools. Its dust is seriously toxic.',
      look: { kind: 'dullmetal', colour: '#b8bab4', desc: 'Hard, brittle, steel-grey metal with a matte finish rather than a mirror — it holds a dull sheen rather than a polish.' } },

    { z: 5, sym: 'B', name: 'Boron', weight: '10.81', cat: 'metalloid', group: 13, period: 2, block: 'p',
      cfg: '1s2 2s2 2p1', en: 2.04, radius: 85, ie: 800.6, melt: 2349, boil: 4200,
      density: '2.34 g/cm³', year: '1808', by: 'Gay-Lussac, Thénard and Humphry Davy',
      abundance: 'About 10 parts per million of the crust; concentrated in borax deposits in dried lake beds.',
      ox: '+3',
      use: 'Borosilicate glass, detergents and fibreglass insulation; boron carbide is one of the hardest materials made.',
      look: { kind: 'powder', colour: '#3d372f', desc: 'Two faces: a dull brown amorphous powder, or hard black-brown crystals with a metallic glint. Neither looks like a metal you could bend.' } },

    { z: 6, sym: 'C', name: 'Carbon', weight: '12.011', cat: 'nonmetal', group: 14, period: 2, block: 'p',
      cfg: '1s2 2s2 2p2', en: 2.55, radius: 70, ie: 1086.5, melt: null, boil: 3915, subl: true,
      density: '2.267 g/cm³ (graphite), 3.515 (diamond)', year: 'Antiquity', by: 'Known since prehistory',
      abundance: 'About 200 parts per million of the crust, and the backbone of every living thing.',
      ox: '+4, +2, -4',
      use: 'Steelmaking, every plastic and fuel there is, electrodes, and — as diamond — cutting tools. Life is built out of it.',
      look: { kind: 'graphite', colour: '#33363d', desc: 'Graphite is black with a slick metallic lustre and leaves grey marks on your fingers. Diamond, the same atoms in a different arrangement, is colourless and blazingly bright.' } },

    { z: 7, sym: 'N', name: 'Nitrogen', weight: '14.007', cat: 'nonmetal', group: 15, period: 2, block: 'p',
      cfg: '1s2 2s2 2p3', en: 3.04, radius: 65, ie: 1402.3, melt: 63.15, boil: 77.355,
      density: '1.2506 g/L at 0 °C', year: '1772', by: 'Daniel Rutherford',
      abundance: '78% of the air by volume; rare in the crust.',
      ox: '+5, +3, -3',
      use: 'Ammonia for fertiliser — roughly half the nitrogen in your body arrived through that one industrial process. Liquid nitrogen is the cheap laboratory coldness.',
      look: { kind: 'gas', colour: '#dbe6f6', glow: '#c78cff', desc: 'Colourless, odourless gas; a clear, water-like liquid when boiled down to 77 K. Its discharge is a pink-violet.' } },

    { z: 8, sym: 'O', name: 'Oxygen', weight: '15.999', cat: 'nonmetal', group: 16, period: 2, block: 'p',
      cfg: '1s2 2s2 2p4', en: 3.44, radius: 60, ie: 1313.9, melt: 54.36, boil: 90.188,
      density: '1.429 g/L at 0 °C', year: '1771', by: 'Carl Wilhelm Scheele (Priestley, independently, 1774)',
      abundance: 'The most abundant element in the crust at about 46% by mass, and 21% of the air.',
      ox: '-2',
      use: 'Steelmaking consumes most of it; the rest goes to hospitals, welding and water treatment.',
      look: { kind: 'gas', colour: '#dfeaf8', glow: '#8fd4ff', desc: 'Colourless as a gas, but liquid and solid oxygen are a distinct pale sky blue, and both are pulled visibly towards a magnet.' } },

    { z: 9, sym: 'F', name: 'Fluorine', weight: '18.998', cat: 'halogen', group: 17, period: 2, block: 'p',
      cfg: '1s2 2s2 2p5', en: 3.98, radius: 50, ie: 1681.0, melt: 53.48, boil: 85.03,
      density: '1.696 g/L at 0 °C', year: '1886', by: 'Henri Moissan (first isolation)',
      abundance: 'About 585 parts per million of the crust, as fluorite and fluorapatite.',
      ox: '-1',
      use: 'Making Teflon and refrigerants, enriching uranium as UF6, and fluoridating toothpaste and water.',
      look: { kind: 'gas', colour: '#e6ea92', glow: '#f2f57a', desc: 'A very pale yellow gas — faint enough that it was long described as colourless. The most reactive element there is; it will burn glass and water.' } },

    { z: 10, sym: 'Ne', name: 'Neon', weight: '20.180', cat: 'noble', group: 18, period: 2, block: 'p',
      cfg: '1s2 2s2 2p6', en: null, radius: null, ie: 2080.7, melt: 24.56, boil: 27.104,
      density: '0.9002 g/L at 0 °C', year: '1898', by: 'William Ramsay and Morris Travers',
      abundance: '18 parts per million of the air; distilled out of liquid air.',
      ox: '0',
      use: 'Signs, high-voltage indicators and helium-neon lasers. Every genuinely red-orange neon sign really is neon; the other colours are other gases.',
      look: { kind: 'gas', colour: '#e9f0fa', glow: '#ff4d1a', desc: 'Colourless gas that gives the most famous glow in chemistry: an intense, unmistakable red-orange with no blue in it at all.' } },

    { z: 11, sym: 'Na', name: 'Sodium', weight: '22.990', cat: 'alkali', group: 1, period: 3, block: 's',
      cfg: '1s2 2s2 2p6 3s1', en: 0.93, radius: 180, ie: 495.8, melt: 370.944, boil: 1156.09,
      density: '0.968 g/cm³', year: '1807', by: 'Humphry Davy',
      abundance: 'About 2.3% of the crust, and the sodium in seawater is why it is salty.',
      ox: '+1',
      use: 'Mostly as its compounds — table salt, caustic soda, glass. The metal itself is a coolant in some reactors and the light in old orange street lamps.',
      look: { kind: 'metal', colour: '#e4e8ec', glow: '#ffb028', desc: 'Bright silver on a fresh cut and dull white within a second or two. Soft as cheese. Its flame and its street lamps are an intense sodium yellow.' } },

    { z: 12, sym: 'Mg', name: 'Magnesium', weight: '24.305', cat: 'alkaline', group: 2, period: 3, block: 's',
      cfg: '1s2 2s2 2p6 3s2', en: 1.31, radius: 150, ie: 737.7, melt: 923, boil: 1363,
      density: '1.738 g/cm³', year: '1755', by: 'Joseph Black (isolated by Davy, 1808)',
      abundance: 'About 2.3% of the crust; also extracted from seawater.',
      ox: '+2',
      use: 'Lightweight alloys for car and aircraft parts, and the metal that made old flash photography flash.',
      look: { kind: 'metal', colour: '#dcdcd6', desc: 'Shiny silvery-white when fresh, going to a thin dull oxide grey. Burns with a white light so bright it is genuinely painful to watch.' } },

    { z: 13, sym: 'Al', name: 'Aluminium', weight: '26.982', cat: 'post', group: 13, period: 3, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p1', en: 1.61, radius: 125, ie: 577.5, melt: 933.47, boil: 2743,
      density: '2.70 g/cm³', year: '1825', by: 'Hans Christian Ørsted',
      abundance: 'The most abundant metal in the crust, about 8% by mass, mined as bauxite.',
      ox: '+3',
      use: 'Everything light and structural — aircraft, cans, window frames, power lines. Recycling it costs about 5% of the energy of making it new.',
      look: { kind: 'metal', colour: '#d5d9dd', desc: 'Silvery-white with a faint blue cast. It does tarnish, instantly, but the oxide is transparent and tight, so it keeps its shine instead of losing it.' } },

    { z: 14, sym: 'Si', name: 'Silicon', weight: '28.085', cat: 'metalloid', group: 14, period: 3, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p2', en: 1.90, radius: 110, ie: 786.5, melt: 1687, boil: 3538,
      density: '2.3290 g/cm³', year: '1823', by: 'Jöns Jacob Berzelius',
      abundance: 'The second most abundant element in the crust at about 28%, nearly all of it as silicate rock and sand.',
      ox: '+4, -4',
      use: 'Glass, concrete and ceramics by weight; chips and solar cells by value. The purified crystal is the substrate of the entire computer industry.',
      look: { kind: 'crystal', colour: '#4b525d', desc: 'Dark bluish-grey with a hard, glassy metallic lustre — a polished wafer is close to a mirror, but a broken lump shows sharp crystalline facets.' } },

    { z: 15, sym: 'P', name: 'Phosphorus', weight: '30.974', cat: 'nonmetal', group: 15, period: 3, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p3', en: 2.19, radius: 100, ie: 1011.8, melt: 317.3, boil: 553.7,
      density: '1.823 g/cm³ (white)', year: '1669', by: 'Hennig Brand',
      abundance: 'About 1050 parts per million of the crust, as phosphate rock.',
      ox: '+5, +3, -3',
      use: 'Fertiliser, overwhelmingly; also matches, flame retardants and the phosphates in detergents. Every cell in you runs on phosphate chemistry.',
      look: { kind: 'crystal', colour: '#efe6b8', desc: 'White phosphorus is a waxy, pale-yellow translucent solid that glows faintly green in the dark and catches fire in air. Red phosphorus, the same element rearranged, is a dull brick-red powder that does neither.' } },

    { z: 16, sym: 'S', name: 'Sulfur', weight: '32.06', cat: 'nonmetal', group: 16, period: 3, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p4', en: 2.58, radius: 100, ie: 999.6, melt: 388.36, boil: 717.8,
      density: '2.07 g/cm³', year: 'Antiquity', by: 'Known since prehistory',
      abundance: 'About 350 parts per million of the crust; most production is a by-product of cleaning sulfur out of oil and gas.',
      ox: '+6, +4, -2',
      use: 'Sulfuric acid, which is made in greater quantity than any other industrial chemical, plus vulcanised rubber and gunpowder.',
      look: { kind: 'crystal', colour: '#e8d33f', desc: 'A bright, slightly greenish lemon yellow — one of the few elements with a colour you would call cheerful. Brittle, dull-to-waxy crystals that crumble in the hand.' } },

    { z: 17, sym: 'Cl', name: 'Chlorine', weight: '35.45', cat: 'halogen', group: 17, period: 3, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p5', en: 3.16, radius: 100, ie: 1251.2, melt: 171.6, boil: 239.11,
      density: '3.2 g/L at 0 °C', year: '1774', by: 'Carl Wilhelm Scheele',
      abundance: 'About 145 parts per million of the crust, and the chloride in every ocean.',
      ox: '+7, +5, +1, -1',
      use: 'Disinfecting drinking water and pools, bleaching, and making PVC. It has saved an enormous number of lives and was also the first chemical weapon.',
      look: { kind: 'gas', colour: '#cfe04a', glow: '#a8f06a', desc: 'A visible pale yellow-green gas — dense enough to pool and see. The colour is where the name comes from; chloros is Greek for pale green.' } },

    { z: 18, sym: 'Ar', name: 'Argon', weight: '39.95', cat: 'noble', group: 18, period: 3, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6', en: null, radius: null, ie: 1520.6, melt: 83.81, boil: 87.302,
      density: '1.784 g/L at 0 °C', year: '1894', by: 'Lord Rayleigh and William Ramsay',
      abundance: '0.93% of the air — the third most common gas in it, ahead of carbon dioxide.',
      ox: '0',
      use: 'A cheap inert blanket: welding shields, the fill in double glazing, and the atmosphere inside old incandescent bulbs.',
      look: { kind: 'gas', colour: '#e4ecf7', glow: '#a172ff', desc: 'Colourless and completely unreactive. Its discharge is a soft lilac-violet, and it is the pale mauve behind a lot of "neon" signage.' } },

    { z: 19, sym: 'K', name: 'Potassium', weight: '39.098', cat: 'alkali', group: 1, period: 4, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 4s1', en: 0.82, radius: 220, ie: 418.8, melt: 336.7, boil: 1032,
      density: '0.862 g/cm³', year: '1807', by: 'Humphry Davy',
      abundance: 'About 2.1% of the crust, in feldspars and evaporite salts.',
      ox: '+1',
      use: 'Potash fertiliser takes almost all of it. Potassium is also the ion your nerve cells pump to fire.',
      look: { kind: 'metal', colour: '#dde1e5', glow: '#c07fe8', desc: 'Silvery-white for about a second, then a blue-grey then yellowish crust. Soft enough to squash. It floats on water — and sets the hydrogen it makes alight, with a lilac flame.' } },

    { z: 20, sym: 'Ca', name: 'Calcium', weight: '40.078', cat: 'alkaline', group: 2, period: 4, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 4s2', en: 1.00, radius: 180, ie: 589.8, melt: 1115, boil: 1757,
      density: '1.55 g/cm³', year: '1808', by: 'Humphry Davy',
      abundance: 'About 4.1% of the crust, as limestone, gypsum and every seashell.',
      ox: '+2',
      use: 'Cement and lime, which between them build most of the built world; also the mineral in your bones and teeth.',
      look: { kind: 'dullmetal', colour: '#dedcd0', desc: 'A dull silvery-white with a faint yellow cast, going grey-white in air. Softer and less shiny than you would guess from the amount of it in your skeleton.' } },

    { z: 21, sym: 'Sc', name: 'Scandium', weight: '44.956', cat: 'transition', group: 3, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d1 4s2', en: 1.36, radius: 160, ie: 633.1, melt: 1814, boil: 3109,
      density: '2.985 g/cm³', year: '1879', by: 'Lars Fredrik Nilson',
      abundance: 'About 22 parts per million of the crust, but nowhere concentrated — which is why it stays expensive.',
      ox: '+3',
      use: 'Aluminium-scandium alloy for bicycle frames and aerospace parts, and scandium iodide in stadium floodlights.',
      look: { kind: 'metal', colour: '#dcdad4', desc: 'Silvery-white with a slight yellow-pink cast once the air has had a go at it. Light for a metal — barely denser than aluminium.' } },

    { z: 22, sym: 'Ti', name: 'Titanium', weight: '47.867', cat: 'transition', group: 4, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d2 4s2', en: 1.54, radius: 140, ie: 658.8, melt: 1941, boil: 3560,
      density: '4.506 g/cm³', year: '1791', by: 'William Gregor',
      abundance: 'About 0.57% of the crust — the ninth most abundant element, mostly as ilmenite and rutile.',
      ox: '+4, +3',
      use: 'Titanium dioxide is the white in almost all white paint, paper and sunscreen. The metal itself goes into aircraft, hip joints and dental implants.',
      look: { kind: 'metal', colour: '#b9bcbf', desc: 'A cool silvery grey, slightly darker and less bright than steel, with a soft satin sheen. Anodising it drives the oxide film to interference colours — blue, purple, gold.' } },

    { z: 23, sym: 'V', name: 'Vanadium', weight: '50.942', cat: 'transition', group: 5, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d3 4s2', en: 1.63, radius: 135, ie: 650.9, melt: 2183, boil: 3680,
      density: '6.11 g/cm³', year: '1801', by: 'Andrés Manuel del Río (rediscovered by Sefström, 1830)',
      abundance: 'About 120 parts per million of the crust; much is recovered from oil residues and steel slag.',
      ox: '+5, +4, +3, +2',
      use: 'Almost all of it strengthens steel — a fraction of a percent makes spanners and springs much tougher. Also the electrolyte in flow batteries.',
      look: { kind: 'metal', colour: '#b8bfc4', desc: 'Bluish-silver and hard, holding a bright polish. Its salts are famous for colour: the same element runs through purple, green, blue and yellow solutions as it changes oxidation state.' } },

    { z: 24, sym: 'Cr', name: 'Chromium', weight: '51.996', cat: 'transition', group: 6, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d5 4s1', en: 1.66, radius: 140, ie: 652.9, melt: 2180, boil: 2944,
      density: '7.15 g/cm³', year: '1794', by: 'Louis-Nicolas Vauquelin',
      abundance: 'About 102 parts per million of the crust, as chromite.',
      ox: '+6, +3, +2',
      use: 'Stainless steel — the chromium is what stops it rusting — and chrome plating. Chromium is also the red in a ruby and the green in an emerald.',
      look: { kind: 'metal', colour: '#cbced2', desc: 'The hardest, brightest mirror of the common metals, with a faint blue cast. Chrome plating looks the way it does because chromium itself really is that reflective.' } },

    { z: 25, sym: 'Mn', name: 'Manganese', weight: '54.938', cat: 'transition', group: 7, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d5 4s2', en: 1.55, radius: 140, ie: 717.3, melt: 1519, boil: 2334,
      density: '7.21 g/cm³', year: '1774', by: 'Johan Gottlieb Gahn',
      abundance: 'About 950 parts per million of the crust, plus vast nodule fields on the deep ocean floor.',
      ox: '+7, +4, +2',
      use: 'Steel cannot practically be made without it — it mops up sulfur and oxygen. Also alkaline batteries and the deep purple of permanganate.',
      look: { kind: 'dullmetal', colour: '#b5b4af', desc: 'Hard, brittle silvery-grey with a slightly pinkish cast, and a matte rather than mirrored surface. It tarnishes to a dull brown-grey.' } },

    { z: 26, sym: 'Fe', name: 'Iron', weight: '55.845', cat: 'transition', group: 8, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d6 4s2', en: 1.83, radius: 140, ie: 762.5, melt: 1811, boil: 3134,
      density: '7.874 g/cm³', year: 'Antiquity', by: 'Known since prehistory',
      abundance: 'About 5.6% of the crust and most of the Earth’s core — by mass it is the most abundant element on the planet.',
      ox: '+3, +2',
      use: 'Steel: about 95% of all metal produced. Also the atom at the centre of haemoglobin, which is why blood is red.',
      look: { kind: 'metal', colour: '#b3b5b7', desc: 'Lustrous silvery-grey when freshly cut or polished, going quickly to the familiar orange-brown rust. Strongly magnetic.' } },

    { z: 27, sym: 'Co', name: 'Cobalt', weight: '58.933', cat: 'transition', group: 9, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d7 4s2', en: 1.88, radius: 135, ie: 760.4, melt: 1768, boil: 3200,
      density: '8.90 g/cm³', year: '1735', by: 'Georg Brandt',
      abundance: 'About 25 parts per million of the crust; mostly a by-product of copper and nickel mining.',
      ox: '+3, +2',
      use: 'Lithium-ion battery cathodes, superalloys for jet turbine blades, and the cobalt blue that has coloured glass and porcelain for a thousand years.',
      look: { kind: 'metal', colour: '#a9b0bb', desc: 'Hard, lustrous and noticeably bluish-grey — more blue in it than iron or nickel. Magnetic, and it keeps its magnetism up to a very high temperature.' } },

    { z: 28, sym: 'Ni', name: 'Nickel', weight: '58.693', cat: 'transition', group: 10, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d8 4s2', en: 1.91, radius: 135, ie: 737.1, melt: 1728, boil: 3003,
      density: '8.908 g/cm³', year: '1751', by: 'Axel Fredrik Cronstedt',
      abundance: 'About 84 parts per million of the crust, and a large fraction of the Earth’s core.',
      ox: '+2',
      use: 'Stainless steel and battery alloys, plating, and coins. It is also the commonest cause of contact allergy in jewellery.',
      look: { kind: 'metal', colour: '#cdc8b8', desc: 'Silvery with a faint warm, golden cast — slightly creamier than chrome. Takes a high polish and resists tarnishing well.' } },

    { z: 29, sym: 'Cu', name: 'Copper', weight: '63.546', cat: 'transition', group: 11, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s1', en: 1.90, radius: 135, ie: 745.5, melt: 1357.77, boil: 2835,
      density: '8.96 g/cm³', year: 'Antiquity', by: 'Known since about 9000 BC',
      abundance: 'About 60 parts per million of the crust; one of the very few metals found in usable form as native nuggets.',
      ox: '+2, +1',
      use: 'Wiring and plumbing, because only silver conducts better and silver is not affordable by the kilometre. Also the copper in bronze and brass.',
      look: { kind: 'metal', colour: '#b87333', desc: 'One of only three coloured metals: a warm reddish-orange with a pink cast on a fresh cut. It darkens to brown and then, given decades of weather, to the pale green of a church roof.' } },

    { z: 30, sym: 'Zn', name: 'Zinc', weight: '65.38', cat: 'transition', group: 12, period: 4, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2', en: 1.65, radius: 135, ie: 906.4, melt: 692.68, boil: 1180,
      density: '7.14 g/cm³', year: '1746', by: 'Andreas Sigismund Marggraf (smelted in India far earlier)',
      abundance: 'About 70 parts per million of the crust, as sphalerite.',
      ox: '+2',
      use: 'Galvanising steel — the zinc corrodes instead of the iron underneath. Also brass, and a trace element you cannot live without.',
      look: { kind: 'dullmetal', colour: '#bcc6c9', desc: 'Bluish-silvery-white, bright on a fresh break and quickly matte grey in air. Galvanised sheet shows its characteristic crystalline "spangle" pattern.' } },

    { z: 31, sym: 'Ga', name: 'Gallium', weight: '69.723', cat: 'post', group: 13, period: 4, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p1', en: 1.81, radius: 130, ie: 578.8, melt: 302.9146, boil: 2673,
      density: '5.91 g/cm³', year: '1875', by: 'Paul-Émile Lecoq de Boisbaudran',
      abundance: 'About 19 parts per million of the crust, recovered as a by-product of aluminium and zinc refining.',
      ox: '+3',
      use: 'Gallium nitride and gallium arsenide semiconductors — blue and white LEDs, laser diodes, fast radio-frequency chips.',
      look: { kind: 'metal', colour: '#c8ccd4', desc: 'Silvery with a faint blue tint, and famous for melting at 29.8 °C — a spoon of it collapses into a mirror-bright puddle in your palm.' } },

    { z: 32, sym: 'Ge', name: 'Germanium', weight: '72.630', cat: 'metalloid', group: 14, period: 4, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p2', en: 2.01, radius: 125, ie: 762.0, melt: 1211.4, boil: 3106,
      density: '5.323 g/cm³', year: '1886', by: 'Clemens Winkler',
      abundance: 'About 1.5 parts per million of the crust; recovered from zinc ores and coal fly ash.',
      ox: '+4, +2',
      use: 'Infrared lenses for thermal cameras, fibre-optic glass, and the polymerisation catalyst for PET bottles. The first transistors were germanium.',
      look: { kind: 'crystal', colour: '#a8aca6', desc: 'Greyish-white, hard, brittle, with a bright metallic lustre on a fresh fracture — it looks like a metal and shatters like glass.' } },

    { z: 33, sym: 'As', name: 'Arsenic', weight: '74.922', cat: 'metalloid', group: 15, period: 4, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p3', en: 2.18, radius: 115, ie: 947.0, melt: null, boil: 887, subl: true,
      density: '5.727 g/cm³', year: 'c. 1250', by: 'Albertus Magnus (compounds known much earlier)',
      abundance: 'About 1.8 parts per million of the crust; a serious contaminant of groundwater in parts of South Asia.',
      ox: '+5, +3, -3',
      use: 'Gallium arsenide semiconductors, lead alloys for car batteries, and — historically — wood preservative and pigment. Notoriously poisonous.',
      look: { kind: 'crystal', colour: '#7c7b77', desc: 'The grey allotrope is brittle, steely and metallic-looking, tarnishing to a dull black. It does not melt at ordinary pressure — it sublimes straight to a garlic-smelling vapour.' } },

    { z: 34, sym: 'Se', name: 'Selenium', weight: '78.971', cat: 'nonmetal', group: 16, period: 4, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p4', en: 2.55, radius: 115, ie: 941.0, melt: 494, boil: 958,
      density: '4.81 g/cm³', year: '1817', by: 'Jöns Jacob Berzelius',
      abundance: 'About 0.05 parts per million of the crust; a by-product of copper refining.',
      ox: '+6, +4, -2',
      use: 'Decolourising glass, pigments, and the photoreceptor drum that made xerographic photocopying possible. An essential trace nutrient at tiny doses, toxic just above them.',
      look: { kind: 'crystal', colour: '#6d6a65', desc: 'Grey selenium is metallic-looking and dark with a semi-metallic sheen; the red allotrope is a striking brick-red powder. Its electrical resistance drops sharply in light.' } },

    { z: 35, sym: 'Br', name: 'Bromine', weight: '79.904', cat: 'halogen', group: 17, period: 4, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p5', en: 2.96, radius: 115, ie: 1139.9, melt: 265.8, boil: 332.0,
      density: '3.1028 g/cm³ (liquid)', year: '1826', by: 'Antoine Jérôme Balard',
      abundance: 'About 2.4 parts per million of the crust; extracted from brines and seawater.',
      ox: '+5, +1, -1',
      use: 'Flame retardants, drilling fluids and some pharmaceuticals. Silver bromide is what made photographic film sensitive to light.',
      look: { kind: 'liquid', colour: '#7d2c14', glow: '#c4531f', desc: 'One of only two elements that are liquid at room temperature: a heavy, dark reddish-brown liquid that constantly gives off a thick orange-brown vapour. The name means stench.' } },

    { z: 36, sym: 'Kr', name: 'Krypton', weight: '83.798', cat: 'noble', group: 18, period: 4, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6', en: 3.00, radius: null, ie: 1350.8, melt: 115.78, boil: 119.93,
      density: '3.749 g/L at 0 °C', year: '1898', by: 'William Ramsay and Morris Travers',
      abundance: '1.1 parts per million of the air; separated from liquid air.',
      ox: '0, +2',
      use: 'High-performance lighting, some lasers, and the fill in energy-efficient window units. For a while the metre was defined by a krypton spectral line.',
      look: { kind: 'gas', colour: '#e6eef8', glow: '#a9e2ff', desc: 'Colourless and almost inert. Its discharge is a whitish blue-green, paler and more silvery than argon’s violet.' } },

    { z: 37, sym: 'Rb', name: 'Rubidium', weight: '85.468', cat: 'alkali', group: 1, period: 5, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 5s1', en: 0.82, radius: 235, ie: 403.0, melt: 312.45, boil: 961,
      density: '1.532 g/cm³', year: '1861', by: 'Robert Bunsen and Gustav Kirchhoff',
      abundance: 'About 90 parts per million of the crust, scattered through potassium minerals rather than concentrated.',
      ox: '+1',
      use: 'Atomic clocks, laser cooling experiments, and specialty glass. Rubidium was the first Bose-Einstein condensate.',
      look: { kind: 'metal', colour: '#dee0e2', glow: '#c2436e', desc: 'Soft, silvery-white and greyer than sodium, tarnishing the instant it sees air. It melts just above body temperature. Its name comes from the deep red lines in its spectrum.' } },

    { z: 38, sym: 'Sr', name: 'Strontium', weight: '87.62', cat: 'alkaline', group: 2, period: 5, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 5s2', en: 0.95, radius: 200, ie: 549.5, melt: 1050, boil: 1650,
      density: '2.64 g/cm³', year: '1790', by: 'Adair Crawford',
      abundance: 'About 370 parts per million of the crust, as celestine and strontianite.',
      ox: '+2',
      use: 'The red in fireworks and road flares, ferrite magnets, and strontium ranelate for bone density.',
      look: { kind: 'dullmetal', colour: '#dcd8c6', desc: 'Silvery-white with a pale yellow cast, going a dull yellow-grey in air. Soft enough to cut. Its flame is an intense scarlet.' } },

    { z: 39, sym: 'Y', name: 'Yttrium', weight: '88.906', cat: 'transition', group: 3, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d1 5s2', en: 1.22, radius: 180, ie: 600.0, melt: 1799, boil: 3203,
      density: '4.472 g/cm³', year: '1794', by: 'Johan Gadolin',
      abundance: 'About 33 parts per million of the crust, always alongside the rare earths.',
      ox: '+3',
      use: 'YAG laser crystals, the red phosphor in older colour televisions, and the yttria that stabilises the zirconia in dental crowns and thermal barrier coatings.',
      look: { kind: 'metal', colour: '#ccced0', desc: 'Silvery, moderately soft, and stable in air as a lump — but the shavings will catch fire. Sits with the rare earths chemically despite not being one.' } },

    { z: 40, sym: 'Zr', name: 'Zirconium', weight: '91.224', cat: 'transition', group: 4, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d2 5s2', en: 1.33, radius: 155, ie: 640.1, melt: 2128, boil: 4650,
      density: '6.52 g/cm³', year: '1789', by: 'Martin Heinrich Klaproth',
      abundance: 'About 165 parts per million of the crust, as zircon sand.',
      ox: '+4',
      use: 'Cladding for nuclear fuel rods, because it is nearly transparent to neutrons, plus ceramics, and cubic zirconia as a diamond substitute.',
      look: { kind: 'metal', colour: '#bcbfc1', desc: 'Greyish-white with a hard lustre, very like titanium to look at. The powder is pyrophoric and was once the flash in disposable flashbulbs.' } },

    { z: 41, sym: 'Nb', name: 'Niobium', weight: '92.906', cat: 'transition', group: 5, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d4 5s1', en: 1.60, radius: 145, ie: 652.1, melt: 2750, boil: 5017,
      density: '8.57 g/cm³', year: '1801', by: 'Charles Hatchett',
      abundance: 'About 20 parts per million of the crust; most of the world supply comes from a single mine region in Brazil.',
      ox: '+5',
      use: 'Micro-alloying steel for pipelines, and the superconducting wire in MRI magnets and particle accelerators.',
      look: { kind: 'metal', colour: '#adb2b8', desc: 'Grey and lustrous with a bluish cast when the oxide layer forms. Anodises to strong interference colours, which is why it turns up in body jewellery.' } },

    { z: 42, sym: 'Mo', name: 'Molybdenum', weight: '95.95', cat: 'transition', group: 6, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d5 5s1', en: 2.16, radius: 145, ie: 684.3, melt: 2896, boil: 4912,
      density: '10.28 g/cm³', year: '1778', by: 'Carl Wilhelm Scheele',
      abundance: 'About 1.2 parts per million of the crust, as molybdenite.',
      ox: '+6, +4',
      use: 'High-strength and high-temperature steels, and molybdenum disulfide as a dry lubricant that works where oil would burn off.',
      look: { kind: 'metal', colour: '#b6b7ba', desc: 'Silvery-grey and very hard, holding its shape at temperatures that soften steel. Its disulfide is a soft, slippery, graphite-like black.' } },

    { z: 43, sym: 'Tc', name: 'Technetium', weight: '[97]', cat: 'transition', group: 7, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d5 5s2', en: 1.90, radius: 135, ie: 702.0, melt: 2430, boil: 4538,
      density: '11 g/cm³', year: '1937', by: 'Carlo Perrier and Emilio Segrè',
      abundance: 'Essentially none — the first element made artificially. Traces occur in uranium ore from spontaneous fission.',
      ox: '+7, +4',
      use: 'Technetium-99m is the workhorse of nuclear medicine: tens of millions of diagnostic scans a year use it.',
      look: { kind: 'metal', colour: '#b0b2b5', desc: 'A shiny grey metal, close to platinum in appearance. Almost nobody has seen a lump of it; it is radioactive and made a milligram at a time.' } },

    { z: 44, sym: 'Ru', name: 'Ruthenium', weight: '101.07', cat: 'transition', group: 8, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d7 5s1', en: 2.20, radius: 130, ie: 710.2, melt: 2607, boil: 4423,
      density: '12.45 g/cm³', year: '1844', by: 'Karl Ernst Claus',
      abundance: 'About 0.001 parts per million of the crust; a by-product of platinum and nickel mining.',
      ox: '+4, +3',
      use: 'Wear-resistant electrical contacts, hard-disk coatings, and catalysts — including the ones that won a Nobel prize for olefin metathesis.',
      look: { kind: 'metal', colour: '#c3c5c7', desc: 'Hard, brittle, silvery-white with a bright lustre. It does not tarnish at room temperature and is very difficult to attack with acid.' } },

    { z: 45, sym: 'Rh', name: 'Rhodium', weight: '102.91', cat: 'transition', group: 9, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d8 5s1', en: 2.28, radius: 135, ie: 719.7, melt: 2237, boil: 3968,
      density: '12.41 g/cm³', year: '1804', by: 'William Hyde Wollaston',
      abundance: 'About 0.0002 parts per million of the crust — one of the rarest non-radioactive elements.',
      ox: '+3',
      use: 'Catalytic converters, where it handles the nitrogen oxides, and the bright plating on white gold jewellery.',
      look: { kind: 'metal', colour: '#d2d5d7', desc: 'A hard, brilliantly reflective silvery-white — whiter and brighter than platinum, which is exactly why jewellery is plated with it.' } },

    { z: 46, sym: 'Pd', name: 'Palladium', weight: '106.42', cat: 'transition', group: 10, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10', en: 2.20, radius: 140, ie: 804.4, melt: 1828.05, boil: 3236,
      density: '12.02 g/cm³', year: '1802', by: 'William Hyde Wollaston',
      abundance: 'About 0.015 parts per million of the crust; mined mainly in Russia and South Africa.',
      ox: '+4, +2',
      use: 'Catalytic converters take most of it; the rest goes into electronics, dentistry and hydrogen purification. It absorbs an astonishing volume of hydrogen gas.',
      look: { kind: 'metal', colour: '#ccced1', desc: 'Silvery-white, soft for a platinum metal, and it keeps a bright surface without tarnishing. It is the only element whose ground state has a completely empty outer s shell.' } },

    { z: 47, sym: 'Ag', name: 'Silver', weight: '107.87', cat: 'transition', group: 11, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s1', en: 1.93, radius: 160, ie: 731.0, melt: 1234.93, boil: 2435,
      density: '10.49 g/cm³', year: 'Antiquity', by: 'Known since about 3000 BC',
      abundance: 'About 0.075 parts per million of the crust; often a by-product of lead and copper mining.',
      ox: '+1',
      use: 'Solar cell contacts and electronics take more of it than jewellery now. It is the best electrical conductor of any element, and the best thermal conductor of any metal — diamond carries heat several times better still.',
      look: { kind: 'metal', colour: '#e8eaec', desc: 'The most reflective metal there is — a brilliant, neutral white mirror. It tarnishes to a brown-black sulfide film, which is why silverware needs polishing.' } },

    { z: 48, sym: 'Cd', name: 'Cadmium', weight: '112.41', cat: 'transition', group: 12, period: 5, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2', en: 1.69, radius: 155, ie: 867.8, melt: 594.22, boil: 1040,
      density: '8.65 g/cm³', year: '1817', by: 'Karl Hermann and Friedrich Stromeyer',
      abundance: 'About 0.15 parts per million of the crust; recovered from zinc refining.',
      ox: '+2',
      use: 'Mostly nickel-cadmium batteries and pigments, both now heavily restricted — cadmium is cumulatively toxic to the kidneys and bones.',
      look: { kind: 'metal', colour: '#cbd0d4', desc: 'Soft, bluish-white and shiny, very like zinc but softer. A bar of it makes a faint crackling "cry" when bent, as tin does.' } },

    { z: 49, sym: 'In', name: 'Indium', weight: '114.82', cat: 'post', group: 13, period: 5, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p1', en: 1.78, radius: 155, ie: 558.3, melt: 429.7485, boil: 2345,
      density: '7.31 g/cm³', year: '1863', by: 'Ferdinand Reich and Hieronymous Theodor Richter',
      abundance: 'About 0.25 parts per million of the crust; entirely a by-product of zinc refining.',
      ox: '+3',
      use: 'Indium tin oxide is the transparent conductor on nearly every touchscreen and LCD panel. Also low-melting solders and cryogenic seals.',
      look: { kind: 'metal', colour: '#d2d5d9', desc: 'Silvery-white, bright, and so soft you can dent it with a fingernail and mark paper with it. It also "cries" audibly when bent.' } },

    { z: 50, sym: 'Sn', name: 'Tin', weight: '118.71', cat: 'post', group: 14, period: 5, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p2', en: 1.96, radius: 145, ie: 708.6, melt: 505.08, boil: 2875,
      density: '7.265 g/cm³ (white tin)', year: 'Antiquity', by: 'Known since about 3500 BC',
      abundance: 'About 2.3 parts per million of the crust, as cassiterite.',
      ox: '+4, +2',
      use: 'Solder, tinplate for food cans, and bronze. Alloying it with copper is what started the Bronze Age.',
      look: { kind: 'metal', colour: '#cfd2d5', desc: 'Silvery-white and soft with a slight blue cast. Below about 13 °C it slowly crumbles into a grey powder — "tin pest", which has ruined organ pipes and buttons.' } },

    { z: 51, sym: 'Sb', name: 'Antimony', weight: '121.76', cat: 'metalloid', group: 15, period: 5, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p3', en: 2.05, radius: 145, ie: 834.0, melt: 903.78, boil: 1908,
      density: '6.697 g/cm³', year: 'Antiquity', by: 'Compounds known since about 3000 BC',
      abundance: 'About 0.2 parts per million of the crust, as stibnite.',
      ox: '+5, +3, -3',
      use: 'Flame retardants, lead-acid battery plates and type metal. Its sulfide was the black kohl eye paint of ancient Egypt.',
      look: { kind: 'crystal', colour: '#bbbec0', desc: 'Silvery-white with a bright, almost mirror-like lustre and a flaky, plate-like crystalline break. Brittle enough to shatter with a hammer.' } },

    { z: 52, sym: 'Te', name: 'Tellurium', weight: '127.60', cat: 'metalloid', group: 16, period: 5, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p4', en: 2.10, radius: 140, ie: 869.3, melt: 722.66, boil: 1261,
      density: '6.24 g/cm³', year: '1782', by: 'Franz-Joseph Müller von Reichenstein',
      abundance: 'About 0.001 parts per million of the crust — rarer in rock than platinum — recovered from copper refining slimes.',
      ox: '+6, +4, -2',
      use: 'Cadmium telluride thin-film solar panels, rewritable optical discs, and an additive that makes steel easier to machine.',
      look: { kind: 'crystal', colour: '#aaacaf', desc: 'Silvery-white, brittle, with a bright metallic lustre on a fresh break. Handle it and your breath smells of garlic for days.' } },

    { z: 53, sym: 'I', name: 'Iodine', weight: '126.90', cat: 'halogen', group: 17, period: 5, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p5', en: 2.66, radius: 140, ie: 1008.4, melt: 386.85, boil: 457.4,
      density: '4.933 g/cm³', year: '1811', by: 'Bernard Courtois',
      abundance: 'About 0.45 parts per million of the crust; extracted from brines and Chilean caliche.',
      ox: '+7, +5, +1, -1',
      use: 'Disinfectant, contrast agent for X-ray imaging, and iodised salt — which quietly eliminated a major cause of preventable brain damage.',
      look: { kind: 'crystal', colour: '#3e3350', glow: '#a86ce0', desc: 'Lustrous blue-black crystals that look almost metallic, and give off a dense violet vapour if you so much as warm them. The vapour is where the name comes from.' } },

    { z: 54, sym: 'Xe', name: 'Xenon', weight: '131.29', cat: 'noble', group: 18, period: 5, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6', en: 2.60, radius: null, ie: 1170.4, melt: 161.40, boil: 165.051,
      density: '5.894 g/L at 0 °C', year: '1898', by: 'William Ramsay and Morris Travers',
      abundance: '0.087 parts per million of the air — the rarest stable gas in it.',
      ox: '0, +2, +4, +6',
      use: 'Camera flash tubes, car headlamps and cinema projector lamps; also a general anaesthetic, and the propellant in ion thrusters.',
      look: { kind: 'gas', colour: '#e7eefa', glow: '#8fb4ff', desc: 'Colourless, but its arc is a brilliant blue-white close to daylight — which is why it lights film sets. It was the first noble gas anyone got to form a compound.' } },

    { z: 55, sym: 'Cs', name: 'Caesium', weight: '132.91', cat: 'alkali', group: 1, period: 6, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 6s1', en: 0.79, radius: 260, ie: 375.7, melt: 301.7, boil: 944,
      density: '1.93 g/cm³', year: '1860', by: 'Robert Bunsen and Gustav Kirchhoff',
      abundance: 'About 3 parts per million of the crust, as pollucite.',
      ox: '+1',
      use: 'The caesium atomic clock defines the second. Also drilling fluids and photoelectric cells.',
      look: { kind: 'metal', colour: '#efd485', desc: 'One of only three elements with a colour of its own rather than silver: a soft, pale gold. It melts at 28.5 °C, so a warm room nearly liquefies it, and it ignites on contact with air.' } },

    { z: 56, sym: 'Ba', name: 'Barium', weight: '137.33', cat: 'alkaline', group: 2, period: 6, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 6s2', en: 0.89, radius: 215, ie: 502.9, melt: 1000, boil: 2118,
      density: '3.51 g/cm³', year: '1772', by: 'Carl Wilhelm Scheele (isolated by Davy, 1808)',
      abundance: 'About 425 parts per million of the crust, as barite.',
      ox: '+2',
      use: 'Barite weights drilling mud; barium sulfate is the "barium meal" that makes a gut visible on an X-ray, safe only because it is spectacularly insoluble.',
      look: { kind: 'dullmetal', colour: '#cfd1cc', desc: 'Silvery-grey and soft, oxidising to a dark grey-black crust almost at once. Its flame is apple green.' } },

    { z: 57, sym: 'La', name: 'Lanthanum', weight: '138.91', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 5d1 6s2', en: 1.10, radius: 195, ie: 538.1, melt: 1193, boil: 3737,
      density: '6.162 g/cm³', year: '1839', by: 'Carl Gustaf Mosander',
      abundance: 'About 39 parts per million of the crust — more common than lead, despite the name "rare earth".',
      ox: '+3',
      use: 'Nickel-metal-hydride battery electrodes, camera lens glass with unusually high refractive index, and cracking catalysts in oil refineries.',
      look: { kind: 'metal', colour: '#d5d7d9', desc: 'Silvery-white and soft enough to cut with a knife, tarnishing to a dull oxide within minutes of exposure.' } },

    { z: 58, sym: 'Ce', name: 'Cerium', weight: '140.12', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f1 5d1 6s2', en: 1.12, radius: 185, ie: 534.4, melt: 1068, boil: 3716,
      density: '6.770 g/cm³', year: '1803', by: 'Berzelius, Hisinger and Klaproth',
      abundance: 'About 67 parts per million of the crust — the most abundant of all the rare earths.',
      ox: '+4, +3',
      use: 'Polishing powder for optical glass, self-cleaning oven coatings, and the ferrocerium in every lighter flint.',
      look: { kind: 'metal', colour: '#d3d5d7', desc: 'Silvery-white and soft. Scratch or file it and it throws sparks — the shavings are pyrophoric, which is the whole trick behind lighter flints.' } },

    { z: 59, sym: 'Pr', name: 'Praseodymium', weight: '140.91', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f3 6s2', en: 1.13, radius: 185, ie: 527.0, melt: 1208, boil: 3403,
      density: '6.77 g/cm³', year: '1885', by: 'Carl Auer von Welsbach',
      abundance: 'About 9.2 parts per million of the crust.',
      ox: '+3',
      use: 'Strengthening magnesium alloys for aircraft engines, and the deep yellow-green glass in welders’ goggles that blocks sodium glare.',
      look: { kind: 'metal', colour: '#cfd2cd', desc: 'Silvery with a faint green cast, and its oxide layer is a distinct yellow-green — the name means "green twin".' } },

    { z: 60, sym: 'Nd', name: 'Neodymium', weight: '144.24', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f4 6s2', en: 1.14, radius: 185, ie: 533.1, melt: 1297, boil: 3347,
      density: '7.01 g/cm³', year: '1885', by: 'Carl Auer von Welsbach',
      abundance: 'About 41.5 parts per million of the crust.',
      ox: '+3',
      use: 'Neodymium-iron-boron magnets — the strongest permanent magnets made, and the reason headphones, hard drives and wind turbines are the size they are.',
      look: { kind: 'metal', colour: '#d0d2d4', desc: 'Bright silvery-white, oxidising quickly to a yellowish then purple-grey crust. Glass doped with it looks lavender in daylight and blue under fluorescent light.' } },

    { z: 61, sym: 'Pm', name: 'Promethium', weight: '[145]', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f5 6s2', en: 1.13, radius: 185, ie: 540.0, melt: 1315, boil: 3273,
      density: '7.26 g/cm³', year: '1945', by: 'Marinsky, Glendenin and Coryell',
      abundance: 'Vanishingly rare — perhaps half a kilogram in the entire crust at any moment, from uranium fission. Effectively all of it is made in reactors.',
      ox: '+3',
      use: 'Beta sources for thickness gauges and, formerly, self-luminous instrument dials. It is the only lanthanide with no stable isotope.',
      look: { kind: 'metal', colour: '#cfd1d3', glow: '#7fe0b0', desc: 'A silvery metal whose salts glow a pale blue-green in the dark from their own radioactivity — not phosphorescence, just decay energy.' } },

    { z: 62, sym: 'Sm', name: 'Samarium', weight: '150.36', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f6 6s2', en: 1.17, radius: 185, ie: 544.5, melt: 1345, boil: 2173,
      density: '7.52 g/cm³', year: '1879', by: 'Paul-Émile Lecoq de Boisbaudran',
      abundance: 'About 7.05 parts per million of the crust.',
      ox: '+3, +2',
      use: 'Samarium-cobalt magnets, which hold their strength at temperatures that would ruin a neodymium magnet, and neutron-absorbing reactor control rods.',
      look: { kind: 'metal', colour: '#cdd0d2', desc: 'Silvery-white and moderately hard, developing a yellow oxide film in air. Named after samarskite, itself named after a Russian mining official — the first element named after a person.' } },

    { z: 63, sym: 'Eu', name: 'Europium', weight: '151.96', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f7 6s2', en: 1.20, radius: 185, ie: 547.1, melt: 1099, boil: 1802,
      density: '5.264 g/cm³', year: '1901', by: 'Eugène-Anatole Demarçay',
      abundance: 'About 2 parts per million of the crust.',
      ox: '+3, +2',
      use: 'The red and blue phosphors in fluorescent lamps and older televisions, and the anti-counterfeiting marks that fluoresce on euro banknotes.',
      look: { kind: 'metal', colour: '#d7d9db', glow: '#ff5a5a', desc: 'The softest and least dense lanthanide, silvery-white and about as reactive as calcium — it oxidises through in air within days. Its compounds fluoresce a vivid red.' } },

    { z: 64, sym: 'Gd', name: 'Gadolinium', weight: '157.25', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f7 5d1 6s2', en: 1.20, radius: 180, ie: 593.4, melt: 1585, boil: 3273,
      density: '7.90 g/cm³', year: '1880', by: 'Jean Charles Galissard de Marignac',
      abundance: 'About 6.2 parts per million of the crust.',
      ox: '+3',
      use: 'MRI contrast agents, and neutron shielding — gadolinium absorbs thermal neutrons better than any other stable element.',
      look: { kind: 'metal', colour: '#cdcfd1', desc: 'Silvery-white with a metallic lustre. It is magnetic below about 20 °C, so a lump of it is attracted to a magnet on a cold day and not on a warm one.' } },

    { z: 65, sym: 'Tb', name: 'Terbium', weight: '158.93', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f9 6s2', en: 1.10, radius: 175, ie: 565.8, melt: 1629, boil: 3396,
      density: '8.23 g/cm³', year: '1843', by: 'Carl Gustaf Mosander',
      abundance: 'About 1.2 parts per million of the crust.',
      ox: '+3',
      use: 'The green phosphor in fluorescent lighting and displays, and Terfenol-D, an alloy that changes shape in a magnetic field and is used in sonar transducers.',
      look: { kind: 'metal', colour: '#cbcdcf', glow: '#5fe07a', desc: 'Silvery-white, soft enough to cut, and stable enough in air to keep its lustre for a while. Its compounds fluoresce a strong green.' } },

    { z: 66, sym: 'Dy', name: 'Dysprosium', weight: '162.50', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f10 6s2', en: 1.22, radius: 175, ie: 573.0, melt: 1680, boil: 2840,
      density: '8.540 g/cm³', year: '1886', by: 'Paul-Émile Lecoq de Boisbaudran',
      abundance: 'About 5.2 parts per million of the crust.',
      ox: '+3',
      use: 'Added to neodymium magnets so they keep working hot — which is what electric car motors and wind turbines need.',
      look: { kind: 'metal', colour: '#d0d2d4', desc: 'Bright silvery-white and soft enough to cut with a knife without sparking. The name means "hard to get at", which was true of separating it.' } },

    { z: 67, sym: 'Ho', name: 'Holmium', weight: '164.93', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f11 6s2', en: 1.23, radius: 175, ie: 581.0, melt: 1734, boil: 2873,
      density: '8.79 g/cm³', year: '1878', by: 'Marc Delafontaine and Jacques-Louis Soret',
      abundance: 'About 1.3 parts per million of the crust.',
      ox: '+3',
      use: 'Holmium lasers for surgery on the prostate and kidney stones, and pole pieces that concentrate the strongest static magnetic fields ever made.',
      look: { kind: 'metal', colour: '#d2d4d6', desc: 'Bright silvery-white and soft. Its salts are a distinct yellow or pink depending on the light, and it has the highest magnetic moment of any element.' } },

    { z: 68, sym: 'Er', name: 'Erbium', weight: '167.26', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f12 6s2', en: 1.24, radius: 175, ie: 589.3, melt: 1802, boil: 3141,
      density: '9.066 g/cm³', year: '1843', by: 'Carl Gustaf Mosander',
      abundance: 'About 3.5 parts per million of the crust.',
      ox: '+3',
      use: 'Erbium-doped fibre amplifiers, which boost the light in undersea cables and are a large part of why long-haul internet works at all.',
      look: { kind: 'metal', colour: '#cfd1d3', glow: '#ff8fb0', desc: 'Silvery-white and soft, fairly stable in air. Erbium glass and glazes are a soft rose pink.' } },

    { z: 69, sym: 'Tm', name: 'Thulium', weight: '168.93', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f13 6s2', en: 1.25, radius: 175, ie: 596.7, melt: 1818, boil: 2223,
      density: '9.32 g/cm³', year: '1879', by: 'Per Teodor Cleve',
      abundance: 'About 0.52 parts per million of the crust — the least abundant lanthanide that is not radioactive.',
      ox: '+3',
      use: 'Portable X-ray sources for field radiography, and surgical lasers. Thulium doping gives some euro banknotes a blue fluorescence.',
      look: { kind: 'metal', colour: '#cdcfd1', desc: 'Silvery-grey, soft, and bright enough to hold a shine. Named after Thule, the old name for the far north.' } },

    { z: 70, sym: 'Yb', name: 'Ytterbium', weight: '173.05', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 6s2', en: 1.10, radius: 175, ie: 603.4, melt: 1097, boil: 1469,
      density: '6.90 g/cm³', year: '1878', by: 'Jean Charles Galissard de Marignac',
      abundance: 'About 3.2 parts per million of the crust.',
      ox: '+3, +2',
      use: 'Ytterbium optical lattice clocks, the most accurate timekeepers built, and fibre lasers for industrial cutting.',
      look: { kind: 'metal', colour: '#d5d7d9', desc: 'Bright, soft and silvery with a slight shine — more malleable than its neighbours. Its electrical resistance rises sharply under pressure, which makes it a useful strain gauge.' } },

    { z: 71, sym: 'Lu', name: 'Lutetium', weight: '174.97', cat: 'lanthanide', group: null, period: 6, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d1 6s2', en: 1.27, radius: 175, ie: 523.5, melt: 1925, boil: 3675,
      density: '9.841 g/cm³', year: '1907', by: 'Georges Urbain and Carl Auer von Welsbach',
      abundance: 'About 0.8 parts per million of the crust; the hardest and densest lanthanide, and the most expensive to separate.',
      ox: '+3',
      use: 'Lutetium oxyorthosilicate crystals in PET scanners, and petroleum cracking catalysts.',
      look: { kind: 'metal', colour: '#d1d3d5', desc: 'Silvery-white, hard and dense for a lanthanide, and reasonably stable in air. Several tables now put it in group 3 rather than in the f-block at all.' } },

    { z: 72, sym: 'Hf', name: 'Hafnium', weight: '178.49', cat: 'transition', group: 4, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d2 6s2', en: 1.30, radius: 155, ie: 658.5, melt: 2506, boil: 4876,
      density: '13.31 g/cm³', year: '1922', by: 'Dirk Coster and George de Hevesy',
      abundance: 'About 3 parts per million of the crust, always mixed in with zirconium and painful to separate from it.',
      ox: '+4',
      use: 'Nuclear reactor control rods — it soaks up neutrons where zirconium ignores them — and hafnium oxide as the gate insulator in modern processors.',
      look: { kind: 'metal', colour: '#c0c3c6', desc: 'Lustrous silvery-grey, ductile, chemically almost indistinguishable from zirconium. It carries the highest melting point of any carbide known.' } },

    { z: 73, sym: 'Ta', name: 'Tantalum', weight: '180.95', cat: 'transition', group: 5, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d3 6s2', en: 1.50, radius: 145, ie: 761.0, melt: 3290, boil: 5731,
      density: '16.69 g/cm³', year: '1802', by: 'Anders Gustaf Ekeberg',
      abundance: 'About 2 parts per million of the crust; the coltan it comes from has funded conflict in central Africa.',
      ox: '+5',
      use: 'The tiny high-capacity capacitors in every phone, plus surgical implants — body tissue tolerates it unusually well.',
      look: { kind: 'metal', colour: '#a8afb8', desc: 'Grey with a distinct blue cast and a hard, bright lustre. Extremely resistant to acid — below 150 °C almost nothing touches it.' } },

    { z: 74, sym: 'W', name: 'Tungsten', weight: '183.84', cat: 'transition', group: 6, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d4 6s2', en: 2.36, radius: 135, ie: 770.0, melt: 3695, boil: 6203,
      density: '19.25 g/cm³', year: '1783', by: 'Juan José and Fausto Elhuyar',
      abundance: 'About 1.25 parts per million of the crust, as wolframite and scheelite.',
      ox: '+6, +4',
      use: 'Tungsten carbide cutting tools and drill bits, radiation shielding, and the filament in every incandescent bulb ever made.',
      look: { kind: 'metal', colour: '#b5b7b9', desc: 'Greyish-white with a steely lustre; the pure metal is brittle as cast and ductile once worked. It has the highest melting point of any metal, at 3422 °C.' } },

    { z: 75, sym: 'Re', name: 'Rhenium', weight: '186.21', cat: 'transition', group: 7, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d5 6s2', en: 1.90, radius: 135, ie: 760.0, melt: 3459, boil: 5903,
      density: '21.02 g/cm³', year: '1925', by: 'Walter Noddack, Ida Tacke and Otto Berg',
      abundance: 'About 0.0007 parts per million of the crust — among the rarest elements in it, and the last stable one to be discovered.',
      ox: '+7, +4',
      use: 'Single-crystal superalloy turbine blades in jet engines, and catalysts that make high-octane petrol.',
      look: { kind: 'metal', colour: '#c2c4c6', desc: 'Silvery-white with a bright lustre, and dense — only platinum, iridium and osmium beat it. Only tungsten melts hotter.' } },

    { z: 76, sym: 'Os', name: 'Osmium', weight: '190.23', cat: 'transition', group: 8, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d6 6s2', en: 2.20, radius: 130, ie: 840.0, melt: 3306, boil: 5285,
      density: '22.59 g/cm³', year: '1803', by: 'Smithson Tennant',
      abundance: 'About 0.0001 parts per million of the crust; recovered from platinum ore.',
      ox: '+4, +3',
      use: 'Very hard alloy tips for fountain pen nibs and instrument pivots, and osmium tetroxide as a stain in electron microscopy.',
      look: { kind: 'metal', colour: '#9fb0c4', desc: 'Lustrous with an unmistakable bluish-white cast — the bluest of the metals. It is the densest element known: a litre of it weighs 22.6 kg.' } },

    { z: 77, sym: 'Ir', name: 'Iridium', weight: '192.22', cat: 'transition', group: 9, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d7 6s2', en: 2.20, radius: 135, ie: 880.0, melt: 2719, boil: 4403,
      density: '22.56 g/cm³', year: '1803', by: 'Smithson Tennant',
      abundance: 'About 0.001 parts per million of the crust — but a worldwide iridium layer in 66-million-year-old rock is the fingerprint of the asteroid that ended the dinosaurs.',
      ox: '+4, +3',
      use: 'Spark plug and crucible tips, and the most corrosion-resistant metal known — it survives molten salts that dissolve everything else.',
      look: { kind: 'metal', colour: '#d1cfc4', desc: 'Silvery-white with a very faint yellow cast, hard and brittle. Its salts run through such a range of colours that it is named for Iris, the rainbow.' } },

    { z: 78, sym: 'Pt', name: 'Platinum', weight: '195.08', cat: 'transition', group: 10, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d9 6s1', en: 2.28, radius: 135, ie: 870.0, melt: 2041.4, boil: 4098,
      density: '21.45 g/cm³', year: '1735', by: 'Antonio de Ulloa (worked in pre-Columbian America)',
      abundance: 'About 0.005 parts per million of the crust; mostly mined in South Africa.',
      ox: '+4, +2',
      use: 'Catalytic converters and chemical catalysis take most of it; jewellery, lab crucibles, and cisplatin chemotherapy take the rest.',
      look: { kind: 'metal', colour: '#d7d9db', desc: 'Greyish-white, dense, ductile, and it does not tarnish at all — a platinum surface looks the same in fifty years. Slightly greyer and less bright than rhodium.' } },

    { z: 79, sym: 'Au', name: 'Gold', weight: '196.97', cat: 'transition', group: 11, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s1', en: 2.54, radius: 135, ie: 890.1, melt: 1337.33, boil: 3243,
      density: '19.30 g/cm³', year: 'Antiquity', by: 'Known since before 4000 BC',
      abundance: 'About 0.004 parts per million of the crust; found as native metal, which is why it was the first metal humans used.',
      ox: '+3, +1',
      use: 'Reserves and jewellery by weight; by function, the corrosion-proof bonding wires and connector plating inside electronics.',
      look: { kind: 'metal', colour: '#f0c14b', desc: 'The only element that is genuinely yellow as a metal — a warm, deep yellow with an orange cast, and it never tarnishes. Beaten thin enough, it transmits green light.' } },

    { z: 80, sym: 'Hg', name: 'Mercury', weight: '200.59', cat: 'transition', group: 12, period: 6, block: 'd',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2', en: 2.00, radius: 150, ie: 1007.1, melt: 234.321, boil: 629.88,
      density: '13.534 g/cm³ (liquid)', year: 'Antiquity', by: 'Known since about 1500 BC',
      abundance: 'About 0.085 parts per million of the crust, as cinnabar.',
      ox: '+2, +1',
      use: 'Fluorescent lamps and some chemical processes; formerly thermometers and barometers, now largely banned for its toxicity.',
      look: { kind: 'liquidmetal', colour: '#dadce0', desc: 'The only metal that is liquid at room temperature: a mirror-bright silver liquid that beads up tightly instead of wetting the glass, because its surface tension is enormous.' } },

    { z: 81, sym: 'Tl', name: 'Thallium', weight: '204.38', cat: 'post', group: 13, period: 6, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p1', en: 1.62, radius: 190, ie: 589.4, melt: 577, boil: 1746,
      density: '11.85 g/cm³', year: '1861', by: 'William Crookes',
      abundance: 'About 0.85 parts per million of the crust; recovered from smelting flue dust.',
      ox: '+3, +1',
      use: 'Infrared optics and a few specialist electronics. It was once a rat poison and a murder weapon — tasteless, colourless and lethal in small doses.',
      look: { kind: 'dullmetal', colour: '#cbcfd3', desc: 'Silvery-white and very soft on a fresh cut, dulling to a bluish-grey within minutes. Named for the bright green line in its spectrum.' } },

    { z: 82, sym: 'Pb', name: 'Lead', weight: '207.2', cat: 'post', group: 14, period: 6, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p2', en: 2.33, radius: 180, ie: 715.6, melt: 600.61, boil: 2022,
      density: '11.34 g/cm³', year: 'Antiquity', by: 'Known since about 6500 BC',
      abundance: 'About 14 parts per million of the crust, as galena.',
      ox: '+4, +2',
      use: 'Lead-acid car batteries take the overwhelming majority. Also radiation shielding. Its use in petrol, paint and pipes has been progressively banned — it is a cumulative neurotoxin.',
      look: { kind: 'dullmetal', colour: '#a4a9ae', desc: 'A fresh cut is bright bluish-white for a few seconds, then it oxidises to the familiar dull, soft grey. Heavy, and soft enough to mark paper.' } },

    { z: 83, sym: 'Bi', name: 'Bismuth', weight: '208.98', cat: 'post', group: 15, period: 6, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p3', en: 2.02, radius: 160, ie: 703.0, melt: 544.7, boil: 1837,
      density: '9.78 g/cm³', year: '1753', by: 'Claude François Geoffroy',
      abundance: 'About 0.009 parts per million of the crust; mostly a by-product of lead refining.',
      ox: '+3, +5',
      use: 'The bismuth in stomach medicines, low-melting fusible alloys for fire sprinklers, and a non-toxic replacement for lead in shot and solder.',
      look: { kind: 'metal', colour: '#cfc1bd', desc: 'Silvery with a pink cast, but its oxide film breaks white light into brilliant iridescent rainbows — and it grows into stepped, hopper-shaped crystals that look manufactured.' } },

    { z: 84, sym: 'Po', name: 'Polonium', weight: '[209]', cat: 'post', group: 16, period: 6, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p4', en: 2.00, radius: 190, ie: 812.1, melt: 527, boil: 1235,
      density: '9.196 g/cm³', year: '1898', by: 'Marie and Pierre Curie',
      abundance: 'Barely present — a trace decay product in uranium ore. Essentially all of it is made in reactors.',
      ox: '+4, +2',
      use: 'Static eliminators and, historically, thermoelectric heat sources for spacecraft. One of the most acutely radiotoxic substances known.',
      look: { kind: 'metal', colour: '#b8babc', glow: '#7fd0ff', desc: 'A soft, silvery-grey metal. A visible sample glows blue in the dark — the air around it is being ionised by its own alpha emission — and it is warm to the touch from decay heat.' } },

    { z: 85, sym: 'At', name: 'Astatine', weight: '[210]', cat: 'halogen', group: 17, period: 6, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p5', en: 2.20, radius: null, ie: 899.0, melt: 575, boil: 610,
      density: 'about 7 g/cm³ (estimated)', year: '1940', by: 'Corson, MacKenzie and Segrè',
      abundance: 'The rarest naturally occurring element — less than a gram exists in the whole crust at any moment.',
      ox: '-1, +1',
      use: 'Astatine-211 is being trialled for targeted alpha-particle cancer therapy. There is no other use; there is not enough of it.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Nobody has ever seen a bulk sample, and nobody will — any visible quantity would vaporise itself with its own decay heat. It is expected to be dark and metallic-looking; that is a prediction, not an observation.' } },

    { z: 86, sym: 'Rn', name: 'Radon', weight: '[222]', cat: 'noble', group: 18, period: 6, block: 'p',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6', en: null, radius: null, ie: 1037.0, melt: 202, boil: 211.5,
      density: '9.73 g/L at 0 °C', year: '1899', by: 'Ernest Rutherford and Robert B. Owens',
      abundance: 'Seeps continuously out of uranium-bearing rock; it is the second leading cause of lung cancer after smoking.',
      ox: '0, +2',
      use: 'Almost none. It was once used in radiotherapy. Today the practical interest is in testing for it and ventilating it out of basements.',
      look: { kind: 'gas', colour: '#e5ecf7', glow: '#ffd05a', desc: 'A colourless, odourless, very dense gas. Cooled to a solid it glows yellow and then orange-red as the temperature drops — light produced by its own radioactivity.' } },

    { z: 87, sym: 'Fr', name: 'Francium', weight: '[223]', cat: 'alkali', group: 1, period: 7, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 7s1', en: 0.79, radius: null, ie: 380.0, melt: 300, boil: 950,
      density: 'about 2.9 g/cm³ (estimated)', year: '1939', by: 'Marguerite Perey',
      abundance: 'Perhaps 30 grams in the entire crust at any instant, all of it decaying as fast as it forms.',
      ox: '+1',
      use: 'None practical. It is studied in atomic physics because its heavy nucleus magnifies effects that are too small to measure in lighter atoms.',
      look: { kind: 'unknown', colour: '#565e6b', desc: 'Never seen. The largest sample ever assembled was about 300,000 atoms held in a magnetic trap, glowing only as a faint point of laser fluorescence. It is presumed to be a silvery metal.' } },

    { z: 88, sym: 'Ra', name: 'Radium', weight: '[226]', cat: 'alkaline', group: 2, period: 7, block: 's',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 7s2', en: 0.90, radius: 215, ie: 509.3, melt: 973, boil: 2010,
      density: '5.5 g/cm³', year: '1898', by: 'Marie and Pierre Curie',
      abundance: 'A trace decay product in uranium ore — roughly one part radium to three million parts uranium.',
      ox: '+2',
      use: 'Historically radioluminescent paint and radiotherapy, both abandoned. The Radium Girls, who pointed their brushes with their lips, are why industrial health law looks the way it does.',
      look: { kind: 'metal', colour: '#e7e9e6', glow: '#a8ffcf', desc: 'A brilliant silvery-white metal that blackens within hours in air. Its compounds give off a pale blue-green glow, which is what made it briefly fashionable and then notorious.' } },

    { z: 89, sym: 'Ac', name: 'Actinium', weight: '[227]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 6d1 7s2', en: 1.10, radius: 195, ie: 499.0, melt: 1500, boil: 3500,
      density: '10 g/cm³', year: '1899', by: 'André-Louis Debierne',
      abundance: 'A trace decay product in uranium ore; most of what is used is made in reactors.',
      ox: '+3',
      use: 'Actinium-225 is a promising alpha emitter for targeted cancer therapy. Also a neutron source when mixed with beryllium.',
      look: { kind: 'metal', colour: '#d0d4d8', glow: '#8fd4ff', desc: 'A soft, silvery-white metal that glows a pale blue in the dark, brightly enough to read by if you had enough of it and did not mind the dose.' } },

    { z: 90, sym: 'Th', name: 'Thorium', weight: '232.04', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 6d2 7s2', en: 1.30, radius: 180, ie: 587.0, melt: 2023, boil: 5061,
      density: '11.7 g/cm³', year: '1829', by: 'Jöns Jacob Berzelius',
      abundance: 'About 9.6 parts per million of the crust — three to four times more common than uranium.',
      ox: '+4',
      use: 'Proposed as a reactor fuel, since it is abundant and its cycle makes less long-lived waste. Historically the glowing mantle in gas lamps.',
      look: { kind: 'metal', colour: '#cfd2d5', desc: 'Silvery-white when cut, tarnishing through grey to black over weeks. Soft and very ductile, and its powder is pyrophoric.' } },

    { z: 91, sym: 'Pa', name: 'Protactinium', weight: '231.04', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f2 6d1 7s2', en: 1.50, radius: 180, ie: 568.0, melt: 1841, boil: 4300,
      density: '15.37 g/cm³', year: '1913', by: 'Kasimir Fajans and Oswald Göhring',
      abundance: 'About one part per trillion of the crust; a decay product of uranium-235.',
      ox: '+5, +4',
      use: 'Dating marine sediments and coral, which is genuinely useful for reconstructing past climate. Nothing else — it is scarce, expensive and highly toxic.',
      look: { kind: 'metal', colour: '#cdd0d3', desc: 'A bright silvery metal with a strong metallic lustre that it holds for a while in air. Superconducting below 1.4 K.' } },

    { z: 92, sym: 'U', name: 'Uranium', weight: '238.03', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f3 6d1 7s2', en: 1.38, radius: 175, ie: 597.6, melt: 1405.3, boil: 4404,
      density: '19.1 g/cm³', year: '1789', by: 'Martin Heinrich Klaproth',
      abundance: 'About 2.7 parts per million of the crust — more common than silver, and dissolved in seawater at three parts per billion.',
      ox: '+6, +5, +4, +3',
      use: 'Nuclear fuel and weapons; depleted uranium as dense ballast and armour. Uranium glass, coloured yellow-green with it, fluoresces bright green under UV.',
      look: { kind: 'metal', colour: '#bbbec1', desc: 'Silvery-grey with a weak lustre on a fresh cut, tarnishing to a dark oxide within days. It is very dense — about 70% heavier than lead for the same volume.' } },

    { z: 93, sym: 'Np', name: 'Neptunium', weight: '[237]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f4 6d1 7s2', en: 1.36, radius: 175, ie: 604.5, melt: 912, boil: 4447,
      density: '20.45 g/cm³', year: '1940', by: 'Edwin McMillan and Philip Abelson',
      abundance: 'Trace amounts form naturally in uranium ore; the rest is a by-product of reactor fuel.',
      ox: '+6, +5, +4, +3',
      use: 'A precursor for making plutonium-238 for spacecraft power supplies, and neutron detection instruments.',
      look: { kind: 'metal', colour: '#c5c8cb', desc: 'A silvery metal, ductile and dense, tarnishing slowly in air. The first transuranic element ever made — named for the planet beyond Uranus.' } },

    { z: 94, sym: 'Pu', name: 'Plutonium', weight: '[244]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f6 7s2', en: 1.28, radius: 175, ie: 584.7, melt: 912.5, boil: 3505,
      density: '19.85 g/cm³', year: '1940', by: 'Glenn T. Seaborg and colleagues',
      abundance: 'Trace natural amounts in uranium ore; effectively all of it is reactor-made.',
      ox: '+6, +5, +4, +3',
      use: 'Nuclear weapons and reactor fuel; plutonium-238 is the heat source in the radioisotope generators that power the Voyager and Curiosity missions.',
      look: { kind: 'dullmetal', colour: '#c9c7bb', desc: 'Silvery-white on a fresh surface, tarnishing rapidly through yellow to a dull olive. It is warm to the touch from its own decay, and it has six different solid forms with wildly different densities.' } },

    { z: 95, sym: 'Am', name: 'Americium', weight: '[243]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f7 7s2', en: 1.13, radius: 175, ie: 578.0, melt: 1449, boil: 2880,
      density: '12 g/cm³', year: '1944', by: 'Glenn T. Seaborg and colleagues',
      abundance: 'Entirely artificial, made in reactors from plutonium.',
      ox: '+3',
      use: 'The one transuranic element in ordinary houses: a tiny americium-241 source ionises the air inside most smoke detectors.',
      look: { kind: 'metal', colour: '#d1d3d5', desc: 'Silvery-white with a faint pink cast, slowly tarnishing in dry air. Freshly made samples glow faintly from their own radiation.' } },

    { z: 96, sym: 'Cm', name: 'Curium', weight: '[247]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f7 6d1 7s2', en: 1.28, radius: null, ie: 581.0, melt: 1613, boil: 3383,
      density: '13.51 g/cm³', year: '1944', by: 'Seaborg, James and Ghiorso',
      abundance: 'Entirely artificial.',
      ox: '+3',
      use: 'Alpha-particle X-ray spectrometers — the instrument that analysed Martian rock on several rovers ran on a curium source.',
      look: { kind: 'metal', colour: '#cfd1d3', glow: '#d07fff', desc: 'A hard, silvery metal that glows purple-red in the dark from its own intense alpha activity, and is hot enough to feel.' } },

    { z: 97, sym: 'Bk', name: 'Berkelium', weight: '[247]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f9 7s2', en: 1.30, radius: null, ie: 601.0, melt: 1259, boil: 2900,
      density: '14.78 g/cm³', year: '1949', by: 'Thompson, Ghiorso and Seaborg',
      abundance: 'Entirely artificial; produced in milligram quantities at best.',
      ox: '+3, +4',
      use: 'Target material for making heavier elements — 22 milligrams of berkelium is what tennessine was made from.',
      look: { kind: 'metal', colour: '#cfd1d3', desc: 'A soft, silvery-white metal. Only a few grams have ever existed, and what is known about how it looks comes from those.' } },

    { z: 98, sym: 'Cf', name: 'Californium', weight: '[251]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f10 7s2', en: 1.30, radius: null, ie: 608.0, melt: 1173, boil: 1743,
      density: '15.1 g/cm³', year: '1950', by: 'The Berkeley group',
      abundance: 'Entirely artificial.',
      ox: '+3',
      use: 'A portable neutron source — used to start reactors, find gold and silver ore, and detect metal fatigue in aircraft. A milligram of it is worth thousands of pounds.',
      look: { kind: 'metal', colour: '#cfd1d3', desc: 'A silvery-white metal, soft and easily cut. It emits so many neutrons that a sample must be handled entirely by remote manipulator.' } },

    { z: 99, sym: 'Es', name: 'Einsteinium', weight: '[252]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f11 7s2', en: 1.30, radius: null, ie: 619.0, melt: 1133, boil: 1269,
      density: '8.84 g/cm³', year: '1952', by: 'Identified in Ivy Mike fallout by Ghiorso and colleagues',
      abundance: 'Entirely artificial; made a few micrograms at a time.',
      ox: '+3',
      use: 'Pure research. Mendelevium was first made by bombarding it, and it is the heaviest element that has been produced in a quantity you can see.',
      look: { kind: 'metal', colour: '#cfd1d3', glow: '#8fc8ff', desc: 'A silvery metal, and the heaviest element ever seen with the naked eye. The famous 1961 sample glowed blue in the dark from its own decay.' } },

    { z: 100, sym: 'Fm', name: 'Fermium', weight: '[257]', cat: 'actinide', group: null, period: 7, block: 'f',
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f12 7s2', en: 1.30, radius: null, ie: 627.0, melt: 1800, boil: null,
      density: 'unknown', year: '1952', by: 'Identified in Ivy Mike fallout by Ghiorso and colleagues',
      abundance: 'Entirely artificial; never made in weighable amounts.',
      ox: '+3',
      use: 'None. It is studied one atom at a time, and it is the heaviest element that can be made by neutron capture rather than by smashing nuclei together.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never seen in bulk. Everything past this point in the table has only ever existed as a handful of atoms, so the appearance is a calculation, not a description.' } },

    { z: 101, sym: 'Md', name: 'Mendelevium', weight: '[258]', cat: 'actinide', group: null, period: 7, block: 'f', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f13 7s2', en: null, radius: null, ie: 635.0, melt: null, boil: null,
      density: 'unknown', year: '1955', by: 'Ghiorso, Harvey, Choppin, Thompson and Seaborg',
      abundance: 'Entirely artificial.',
      ox: '+3, +2',
      use: 'None. It was the first element made and identified one atom at a time — seventeen atoms in the original experiment.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. Presumed to be a silvery metal like its neighbours; that is inference from the periodic trend, not an observation.' } },

    { z: 102, sym: 'No', name: 'Nobelium', weight: '[259]', cat: 'actinide', group: null, period: 7, block: 'f', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 7s2', en: null, radius: null, ie: 642.0, melt: null, boil: null,
      density: 'unknown', year: '1966', by: 'JINR Dubna (credit was disputed for decades)',
      abundance: 'Entirely artificial.',
      ox: '+2, +3',
      use: 'None. It is unusual among the actinides in preferring the +2 state, which is a relativistic effect on the 5f shell.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 103, sym: 'Lr', name: 'Lawrencium', weight: '[266]', cat: 'actinide', group: null, period: 7, block: 'f', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 7s2 7p1', en: null, radius: null, ie: 478.6, melt: null, boil: null,
      density: 'unknown', year: '1961–1971', by: 'Berkeley and JINR Dubna',
      abundance: 'Entirely artificial.',
      ox: '+3',
      use: 'None. Its first ionisation energy was finally measured in 2015 and came out remarkably low, which was strong evidence for the predicted 7p ground state.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 104, sym: 'Rf', name: 'Rutherfordium', weight: '[267]', cat: 'transition', group: 4, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d2 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1964–1969', by: 'JINR Dubna and Berkeley',
      abundance: 'Entirely artificial.',
      ox: '+4 (predicted)',
      use: 'None. Chemistry experiments on a few atoms suggest it behaves like hafnium, as the table says it should.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. Predicted to be a dense silvery metal; no sample has existed long enough to look at.' } },

    { z: 105, sym: 'Db', name: 'Dubnium', weight: '[268]', cat: 'transition', group: 5, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d3 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1968–1970', by: 'JINR Dubna and Berkeley',
      abundance: 'Entirely artificial.',
      ox: '+5 (predicted)',
      use: 'None beyond research into whether the periodic trends still hold this far out.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 106, sym: 'Sg', name: 'Seaborgium', weight: '[269]', cat: 'transition', group: 6, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d4 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1974', by: 'The Berkeley group',
      abundance: 'Entirely artificial.',
      ox: '+6 (predicted)',
      use: 'None. It was the first element named after a living person, which caused an argument at the time.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 107, sym: 'Bh', name: 'Bohrium', weight: '[270]', cat: 'transition', group: 7, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d5 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1981', by: 'GSI Darmstadt',
      abundance: 'Entirely artificial.',
      ox: '+7 (predicted)',
      use: 'None. Six atoms were enough to show it forms a volatile oxide chloride, like rhenium.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 108, sym: 'Hs', name: 'Hassium', weight: '[270]', cat: 'transition', group: 8, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d6 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1984', by: 'GSI Darmstadt',
      abundance: 'Entirely artificial.',
      ox: '+8 (predicted)',
      use: 'None. Its tetroxide was made and shown to behave like osmium tetroxide — chemistry done on single atoms.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. Predicted to be extremely dense, perhaps denser than osmium, but nobody has weighed any.' } },

    { z: 109, sym: 'Mt', name: 'Meitnerium', weight: '[278]', cat: 'unknown', group: 9, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d7 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1982', by: 'GSI Darmstadt',
      abundance: 'Entirely artificial.',
      ox: '+3 (predicted)',
      use: 'None. Its configuration above is itself a prediction — it has never been measured.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk, and not enough is known to place it confidently in a category, let alone describe it.' } },

    { z: 110, sym: 'Ds', name: 'Darmstadtium', weight: '[281]', cat: 'unknown', group: 10, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d8 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1994', by: 'GSI Darmstadt',
      abundance: 'Entirely artificial.',
      ox: '+6 (predicted)',
      use: 'None. A few atoms have been made; the longest-lived isotope lasts around ten seconds.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 111, sym: 'Rg', name: 'Roentgenium', weight: '[282]', cat: 'unknown', group: 11, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d9 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1994', by: 'GSI Darmstadt',
      abundance: 'Entirely artificial.',
      ox: '+3 (predicted)',
      use: 'None. It sits below gold, and relativistic calculations suggest it might even be yellow — which nobody will ever check.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. Some calculations put a colour on it; none of them counts as having seen it.' } },

    { z: 112, sym: 'Cn', name: 'Copernicium', weight: '[285]', cat: 'unknown', group: 12, period: 7, block: 'd', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d10 7s2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1996', by: 'GSI Darmstadt',
      abundance: 'Entirely artificial.',
      ox: '+2 (predicted)',
      use: 'None. Relativistic effects are predicted to make it a volatile liquid, or even a gas, at room temperature — a mercury that went further.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. Predicted to be liquid or gaseous at room temperature, which would be remarkable if anyone could ever make enough to check.' } },

    { z: 113, sym: 'Nh', name: 'Nihonium', weight: '[286]', cat: 'unknown', group: 13, period: 7, block: 'p', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d10 7s2 7p1', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '2004', by: 'RIKEN, Japan',
      abundance: 'Entirely artificial.',
      ox: '+1 (predicted)',
      use: 'None. It is the first element discovered in Asia, which is what the name records.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 114, sym: 'Fl', name: 'Flerovium', weight: '[289]', cat: 'unknown', group: 14, period: 7, block: 'p', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d10 7s2 7p2', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '1999', by: 'JINR Dubna with Livermore',
      abundance: 'Entirely artificial.',
      ox: '+2 (predicted)',
      use: 'None. It sits near the predicted "island of stability", so its half-life is of real theoretical interest.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. Experiments on single atoms disagree about whether it behaves like a metal or like a noble gas.' } },

    { z: 115, sym: 'Mc', name: 'Moscovium', weight: '[290]', cat: 'unknown', group: 15, period: 7, block: 'p', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d10 7s2 7p3', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '2003', by: 'JINR Dubna with Livermore',
      abundance: 'Entirely artificial.',
      ox: '+1 (predicted)',
      use: 'None. Fewer than a hundred atoms have ever been made.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 116, sym: 'Lv', name: 'Livermorium', weight: '[293]', cat: 'unknown', group: 16, period: 7, block: 'p', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d10 7s2 7p4', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '2000', by: 'JINR Dubna with Livermore',
      abundance: 'Entirely artificial.',
      ox: '+2 (predicted)',
      use: 'None. Its longest-lived isotope survives for tens of milliseconds.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 117, sym: 'Ts', name: 'Tennessine', weight: '[294]', cat: 'unknown', group: 17, period: 7, block: 'p', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d10 7s2 7p5', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '2010', by: 'JINR Dubna with Oak Ridge and Vanderbilt',
      abundance: 'Entirely artificial.',
      ox: '+1 (predicted)',
      use: 'None. It sits in the halogen column but is not expected to behave much like one.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. No appearance has been measured.' } },

    { z: 118, sym: 'Og', name: 'Oganesson', weight: '[294]', cat: 'unknown', group: 18, period: 7, block: 'p', predicted: true,
      cfg: '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6 4f14 5d10 6s2 6p6 5f14 6d10 7s2 7p6', en: null, radius: null, ie: null, melt: null, boil: null,
      density: 'unknown', year: '2002', by: 'JINR Dubna with Livermore',
      abundance: 'Entirely artificial.',
      ox: '0 (predicted)',
      use: 'None. Only a handful of atoms have ever existed, each for about a millisecond.',
      look: { kind: 'unknown', colour: '#4e5460', desc: 'Never observed in bulk. It sits under the noble gases, but relativistic calculations predict it would be a reactive solid at room temperature rather than an inert gas.' } }
  ];

  /* ======================================================================
     LOOKUP TABLES
     ====================================================================== */

  var CATS = {
    alkali:     { label: 'Alkali metal',           colour: '#c0453c' },
    alkaline:   { label: 'Alkaline earth metal',   colour: '#d18a2b' },
    transition: { label: 'Transition metal',       colour: '#3f6fa8' },
    post:       { label: 'Post-transition metal',  colour: '#4b8f88' },
    metalloid:  { label: 'Metalloid',              colour: '#8d8a35' },
    nonmetal:   { label: 'Reactive nonmetal',      colour: '#3f9a58' },
    halogen:    { label: 'Halogen',                colour: '#2f9fae' },
    noble:      { label: 'Noble gas',              colour: '#7a56c0' },
    lanthanide: { label: 'Lanthanide',             colour: '#c14b8c' },
    actinide:   { label: 'Actinide',               colour: '#9a5560' },
    unknown:    { label: 'Chemistry unknown',      colour: '#565f6d' }
  };
  var CAT_ORDER = ['alkali', 'alkaline', 'transition', 'post', 'metalloid',
                   'nonmetal', 'halogen', 'noble', 'lanthanide', 'actinide', 'unknown'];

  var BLOCKS = {
    s: { label: 's-block', colour: '#b8544c' },
    p: { label: 'p-block', colour: '#3f7fa8' },
    d: { label: 'd-block', colour: '#4f9a70' },
    f: { label: 'f-block', colour: '#a05a9e' }
  };
  var BLOCK_ORDER = ['s', 'p', 'd', 'f'];

  var STATES = {
    solid:   { label: 'Solid',   colour: '#5f7fb8' },
    liquid:  { label: 'Liquid',  colour: '#2f9e8f' },
    gas:     { label: 'Gas',     colour: '#c9903a' },
    unknown: { label: 'Unknown', colour: '#4a5566' }
  };
  var STATE_ORDER = ['solid', 'liquid', 'gas', 'unknown'];

  /* The surface kinds the appearance renderer knows how to draw, and the
     words used for them in the panel. */
  var KINDS = {
    metal:       'Lustrous metal',
    dullmetal:   'Dull or matte metal',
    liquidmetal: 'Liquid metal',
    gas:         'Gas',
    liquid:      'Liquid',
    crystal:     'Brittle crystalline solid',
    powder:      'Powder or amorphous solid',
    graphite:    'Black lustre',
    unknown:     'Never seen'
  };
  var KIND_ORDER = ['metal', 'dullmetal', 'liquidmetal', 'crystal', 'graphite',
                    'powder', 'liquid', 'gas', 'unknown'];

  var NOBLE_Z = [2, 10, 18, 36, 54, 86];

  /* ======================================================================
     SMALL HELPERS
     ====================================================================== */

  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function hexRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function toHex(rgb) {
    var out = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.max(0, Math.min(255, Math.round(rgb[i]))).toString(16);
      out += v.length < 2 ? '0' + v : v;
    }
    return out;
  }
  function mix(hex, target, amt) {
    var a = hexRgb(hex);
    return toHex([a[0] + (target[0] - a[0]) * amt,
                  a[1] + (target[1] - a[1]) * amt,
                  a[2] + (target[2] - a[2]) * amt]);
  }
  function lighten(hex, amt) { return mix(hex, [255, 255, 255], amt); }
  function darken(hex, amt) { return mix(hex, [0, 0, 0], amt); }
  function rgba(hex, a) { var c = hexRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  /* A tiny deterministic generator, seeded from the atomic number, so the
     grain speckle on a powder differs between boron and phosphorus but is the
     same every time you open the page. Nothing here needs cryptographic
     randomness, and Math.random would make the tiles flicker on re-render. */
  function seeded(seed) {
    var s = (seed * 48271) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  /* Split "1s2 2s2 2p6" into [{n:1,l:'s',e:2}, ...]. */
  function parseCfg(cfg) {
    var out = [];
    var parts = String(cfg).split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\d)([spdf])(\d+)$/.exec(parts[i]);
      if (m) out.push({ n: +m[1], l: m[2], e: +m[3] });
    }
    return out;
  }

  /* Electrons per principal shell, summed straight out of the configuration.
     This is the number the shell diagram draws, so the picture cannot disagree
     with the configuration printed beside it. */
  function shellsOf(cfg) {
    var sub = parseCfg(cfg), sh = [], i;
    for (i = 0; i < sub.length; i++) {
      while (sh.length < sub[i].n) sh.push(0);
      sh[sub[i].n - 1] += sub[i].e;
    }
    while (sh.length && sh[sh.length - 1] === 0) sh.pop();
    return sh;
  }

  /* The noble-gas shorthand, computed rather than stored. The configurations
     above are written f, d, s, p within each period block precisely so that
     the previous noble gas is a literal string prefix; if that ever stops
     being true this returns the full configuration rather than a wrong one. */
  var CFG_BY_Z = {};
  var SYM_BY_Z = {};
  function shorthand(el) {
    var i, anchor = null;
    for (i = NOBLE_Z.length - 1; i >= 0; i--) {
      if (NOBLE_Z[i] < el.z) { anchor = NOBLE_Z[i]; break; }
    }
    if (anchor == null) return el.cfg;
    var base = CFG_BY_Z[anchor];
    if (!base || el.cfg.indexOf(base + ' ') !== 0) return el.cfg;
    return '[' + SYM_BY_Z[anchor] + '] ' + el.cfg.slice(base.length + 1);
  }

  /* Render "1s2 2p6" with real <sup> elements, so a screen reader says
     "1 s 2" rather than reading a superscript character it may not know. */
  function cfgNodes(cfg) {
    var frag = document.createDocumentFragment();
    var parts = String(cfg).split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      if (i) frag.appendChild(document.createTextNode(' '));
      var m = /^(\[\w+\]|\d[spdf])(\d*)$/.exec(parts[i]);
      if (!m) { frag.appendChild(document.createTextNode(parts[i])); continue; }
      frag.appendChild(document.createTextNode(m[1]));
      if (m[2]) {
        var sup = document.createElement('sup');
        sup.textContent = m[2];
        frag.appendChild(sup);
      }
    }
    return frag;
  }

  /* State of matter at 1 atm and temperature T (kelvin).

     The order of the tests matters. Helium has no melting point at
     atmospheric pressure at all — it stays liquid all the way down unless you
     squeeze it — so a null melt with a known boil means liquid below the
     boiling point, not "unknown". Carbon and arsenic never melt at 1 atm
     either, but for the opposite reason: they sublime, so below the
     sublimation point they are solid. The `subl` flag is what separates those
     two cases, and without it one of them would come out wrong. */
  function stateAt(el, T) {
    if (el.subl) {
      if (el.boil == null) return 'unknown';
      return T >= el.boil ? 'gas' : 'solid';
    }
    if (el.boil != null && T >= el.boil) return 'gas';
    if (el.melt != null) return T >= el.melt ? 'liquid' : 'solid';
    if (el.boil != null) return 'liquid';
    return 'unknown';
  }

  function celsius(k) { return (k - 273.15).toFixed(1).replace('-', '−'); }
  function kelvinText(k) { return k + ' K (' + celsius(k) + ' °C)'; }

  /* ======================================================================
     APPEARANCE — the small tile swatch, as layered CSS gradients
     ----------------------------------------------------------------------
     Each surface kind gets its own recipe, built from the element's single
     stated base colour. A lustrous metal is a body gradient with a hard
     specular sweep across it and a faint brushed grain; a dull metal keeps
     the grain and loses most of the specular; a gas is a soft glow on near
     black; a crystal is a conic gradient, which is what makes facets read as
     facets. The conic layer sits on top of a plain linear one, so an engine
     without conic-gradient support drops that layer and still shows a shaded
     solid rather than nothing.
     ====================================================================== */
  function lookCss(el) {
    var c = el.look.colour;
    var kind = el.look.kind;
    var lo = darken(c, 0.58), md = darken(c, 0.2), hi = lighten(c, 0.45), wh = lighten(c, 0.78);
    var glow = el.look.glow || lighten(c, 0.35);
    var rnd, i, dots;

    if (kind === 'metal') {
      return 'linear-gradient(112deg, rgba(255,255,255,0) 24%, rgba(255,255,255,.55) 40%, rgba(255,255,255,.12) 48%, rgba(255,255,255,0) 58%),' +
             'repeating-linear-gradient(112deg, rgba(255,255,255,.055) 0 1px, rgba(0,0,0,.05) 1px 3px),' +
             'linear-gradient(158deg, ' + wh + ' 0%, ' + hi + ' 22%, ' + c + ' 55%, ' + lo + ' 100%)';
    }
    if (kind === 'dullmetal') {
      return 'linear-gradient(112deg, rgba(255,255,255,0) 26%, rgba(255,255,255,.17) 44%, rgba(255,255,255,0) 62%),' +
             'repeating-linear-gradient(74deg, rgba(255,255,255,.04) 0 2px, rgba(0,0,0,.07) 2px 5px),' +
             'linear-gradient(158deg, ' + hi + ' 0%, ' + c + ' 52%, ' + lo + ' 100%)';
    }
    if (kind === 'liquidmetal') {
      return 'radial-gradient(58% 44% at 32% 24%, rgba(255,255,255,.95) 0%, rgba(255,255,255,.25) 34%, rgba(255,255,255,0) 62%),' +
             'radial-gradient(130% 120% at 50% 118%, ' + lo + ' 0%, ' + c + ' 58%, ' + hi + ' 100%)';
    }
    if (kind === 'liquid') {
      return 'linear-gradient(180deg, ' + rgba(glow, 0.55) + ' 0%, ' + rgba(glow, 0.12) + ' 34%, rgba(0,0,0,0) 42%),' +
             'radial-gradient(46% 26% at 30% 56%, rgba(255,255,255,.45), rgba(255,255,255,0) 72%),' +
             'linear-gradient(180deg, rgba(0,0,0,0) 40%, ' + hi + ' 46%, ' + c + ' 66%, ' + lo + ' 100%)';
    }
    if (kind === 'gas') {
      return 'radial-gradient(68% 62% at 50% 54%, ' + rgba(glow, 0.62) + ' 0%, ' + rgba(glow, 0.2) + ' 46%, rgba(0,0,0,0) 74%),' +
             'radial-gradient(26% 22% at 34% 34%, rgba(255,255,255,.16), rgba(255,255,255,0) 70%),' +
             'linear-gradient(178deg, #0a0f1a 0%, #05070d 100%)';
    }
    if (kind === 'crystal') {
      return 'conic-gradient(from 208deg at 42% 36%, ' + hi + ', ' + c + ' 18%, ' + lo + ' 38%, ' + c + ' 56%, ' + wh + ' 72%, ' + md + ' 88%, ' + hi + ' 100%),' +
             'linear-gradient(158deg, ' + hi + ', ' + c + ' 50%, ' + lo + ')';
    }
    if (kind === 'graphite') {
      return 'linear-gradient(104deg, rgba(255,255,255,0) 28%, rgba(200,216,238,.5) 39%, rgba(255,255,255,0) 46%),' +
             'repeating-linear-gradient(104deg, rgba(255,255,255,.06) 0 1px, rgba(0,0,0,.34) 1px 4px),' +
             'linear-gradient(158deg, ' + hi + ' 0%, ' + c + ' 45%, ' + darken(c, 0.7) + ' 100%)';
    }
    if (kind === 'powder') {
      rnd = seeded(el.z * 97 + 13);
      dots = [];
      for (i = 0; i < 16; i++) {
        dots.push('radial-gradient(1.6px 1.6px at ' + (rnd() * 100).toFixed(1) + '% ' +
                  (rnd() * 100).toFixed(1) + '%, ' + (rnd() < 0.5 ? rgba(wh, 0.4) : rgba(lo, 0.65)) + ', rgba(0,0,0,0) 72%)');
      }
      return dots.join(',') + ',linear-gradient(158deg, ' + hi + ' 0%, ' + c + ' 55%, ' + lo + ' 100%)';
    }
    /* unknown */
    return 'repeating-linear-gradient(45deg, rgba(148,163,184,.16) 0 5px, rgba(148,163,184,.05) 5px 10px),' +
           'linear-gradient(158deg, #2b3341 0%, #141922 100%)';
  }

  /* ======================================================================
     APPEARANCE — the large panel swatch, as inline SVG
     ----------------------------------------------------------------------
     The tile recipe above is a flat rectangle of colour. At panel size that
     is not enough: an ingot needs edges to read as an ingot, a gas needs a
     tube around it, a liquid needs a meniscus and a vapour space. So the big
     swatch draws an actual object per surface kind, with real gradients and
     an feTurbulence grain layered over the metal, crystal and powder faces.
     Every id is suffixed with the atomic number, because two of these could
     in principle be in the document at once.

     Built as a string and handed to innerHTML. Nothing in it is interpolated
     from anything a visitor typed — every value comes from the table above —
     and the alternative, forty createElementNS calls per shape, would bury
     the drawing in ceremony.
     ====================================================================== */
  function svgSwatch(el) {
    var c = el.look.colour, kind = el.look.kind, z = el.z;
    var lo = darken(c, 0.6), md = darken(c, 0.26), hi = lighten(c, 0.4), wh = lighten(c, 0.8);
    var glow = el.look.glow || null;
    var s = [];
    var u = function (name) { return name + '_' + z; };

    s.push('<svg class="pt-svg" viewBox="0 0 300 150" role="img" xmlns="http://www.w3.org/2000/svg">');
    s.push('<defs>');
    s.push('<linearGradient id="' + u('stage') + '" x1="0" y1="0" x2="0" y2="1">' +
           '<stop offset="0" stop-color="#101827"/><stop offset="1" stop-color="#05080f"/></linearGradient>');
    s.push('<filter id="' + u('grain') + '" x="0" y="0" width="100%" height="100%">' +
           '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="' + z + '"/>' +
           '<feColorMatrix type="saturate" values="0"/></filter>');
    s.push('<filter id="' + u('soft') + '" x="-60%" y="-90%" width="220%" height="280%">' +
           '<feGaussianBlur stdDeviation="13"/></filter>');

    if (kind === 'metal' || kind === 'dullmetal') {
      var band = kind === 'metal' ? wh : lighten(c, 0.3);
      s.push('<linearGradient id="' + u('top') + '" x1="0" y1="0" x2="1" y2="0.2">' +
             '<stop offset="0" stop-color="' + md + '"/>' +
             '<stop offset="0.26" stop-color="' + band + '"/>' +
             '<stop offset="0.42" stop-color="' + hi + '"/>' +
             '<stop offset="0.74" stop-color="' + c + '"/>' +
             '<stop offset="1" stop-color="' + md + '"/></linearGradient>');
      s.push('<linearGradient id="' + u('sideR') + '" x1="0" y1="0" x2="0" y2="1">' +
             '<stop offset="0" stop-color="' + c + '"/><stop offset="1" stop-color="' + lo + '"/></linearGradient>');
      s.push('<linearGradient id="' + u('sideL') + '" x1="0" y1="0" x2="0" y2="1">' +
             '<stop offset="0" stop-color="' + md + '"/><stop offset="1" stop-color="' + darken(c, 0.75) + '"/></linearGradient>');
      s.push('<clipPath id="' + u('clip') + '">' +
             '<polygon points="62,60 196,34 254,60 120,86"/>' +
             '<polygon points="62,60 120,86 120,124 62,98"/>' +
             '<polygon points="120,86 254,60 254,98 120,124"/></clipPath>');
    } else if (kind === 'liquidmetal') {
      s.push('<radialGradient id="' + u('bead') + '" cx="0.34" cy="0.24" r="0.9">' +
             '<stop offset="0" stop-color="' + wh + '"/><stop offset="0.2" stop-color="' + hi + '"/>' +
             '<stop offset="0.6" stop-color="' + c + '"/><stop offset="1" stop-color="' + lo + '"/></radialGradient>');
    } else if (kind === 'liquid') {
      s.push('<linearGradient id="' + u('liq') + '" x1="0" y1="0" x2="0.35" y2="1">' +
             '<stop offset="0" stop-color="' + hi + '"/><stop offset="0.4" stop-color="' + c + '"/>' +
             '<stop offset="1" stop-color="' + lo + '"/></linearGradient>');
      s.push('<radialGradient id="' + u('vap') + '"><stop offset="0" stop-color="' + rgba(glow || hi, 0.85) + '"/>' +
             '<stop offset="1" stop-color="' + rgba(glow || hi, 0) + '"/></radialGradient>');
    } else if (kind === 'gas') {
      var g = glow || lighten(c, 0.3);
      s.push('<radialGradient id="' + u('gl') + '">' +
             '<stop offset="0" stop-color="' + g + '" stop-opacity="0.95"/>' +
             '<stop offset="0.5" stop-color="' + g + '" stop-opacity="0.42"/>' +
             '<stop offset="1" stop-color="' + g + '" stop-opacity="0"/></radialGradient>');
    } else if (kind === 'crystal' || kind === 'graphite') {
      s.push('<linearGradient id="' + u('f1') + '" x1="0" y1="0" x2="0.6" y2="1">' +
             '<stop offset="0" stop-color="' + hi + '"/><stop offset="1" stop-color="' + lo + '"/></linearGradient>');
      s.push('<linearGradient id="' + u('f2') + '" x1="1" y1="0" x2="0" y2="1">' +
             '<stop offset="0" stop-color="' + wh + '"/><stop offset="1" stop-color="' + md + '"/></linearGradient>');
      s.push('<linearGradient id="' + u('f3') + '" x1="0" y1="1" x2="1" y2="0">' +
             '<stop offset="0" stop-color="' + darken(c, 0.72) + '"/><stop offset="1" stop-color="' + c + '"/></linearGradient>');
    } else if (kind === 'powder') {
      s.push('<radialGradient id="' + u('heap') + '" cx="0.4" cy="0.18" r="0.95">' +
             '<stop offset="0" stop-color="' + hi + '"/><stop offset="0.55" stop-color="' + c + '"/>' +
             '<stop offset="1" stop-color="' + lo + '"/></radialGradient>');
    } else {
      s.push('<pattern id="' + u('hatch') + '" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
             '<rect width="4" height="10" fill="rgba(148,163,184,0.12)"/></pattern>');
    }
    s.push('</defs>');
    s.push('<rect width="300" height="150" rx="10" fill="url(#' + u('stage') + ')"/>');

    if (kind === 'metal' || kind === 'dullmetal') {
      /* A soft coloured halo for the elements that have a colour beyond the
         metal itself — an alkali flame test, or the radioluminescence of
         radium and curium. Skipped entirely when there is no such colour. */
      if (glow) {
        s.push('<ellipse cx="158" cy="80" rx="120" ry="52" fill="' + rgba(glow, 0.3) +
               '" filter="url(#' + u('soft') + ')"/>');
      }
      s.push('<ellipse cx="160" cy="130" rx="104" ry="12" fill="rgba(0,0,0,0.55)" filter="url(#' + u('soft') + ')"/>');
      s.push('<polygon points="62,60 120,86 120,124 62,98" fill="url(#' + u('sideL') + ')"/>');
      s.push('<polygon points="120,86 254,60 254,98 120,124" fill="url(#' + u('sideR') + ')"/>');
      s.push('<polygon points="62,60 196,34 254,60 120,86" fill="url(#' + u('top') + ')"/>');
      s.push('<g clip-path="url(#' + u('clip') + ')"><rect width="300" height="150" filter="url(#' + u('grain') +
             ')" opacity="' + (kind === 'metal' ? '0.1' : '0.2') + '" style="mix-blend-mode:overlay"/></g>');
      s.push('<polyline points="62,60 196,34 254,60" fill="none" stroke="' + rgba(wh, 0.55) + '" stroke-width="1"/>');
      s.push('<polyline points="62,60 62,98 120,124 254,98" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>');

    } else if (kind === 'liquidmetal') {
      s.push('<ellipse cx="150" cy="128" rx="106" ry="12" fill="rgba(0,0,0,0.55)" filter="url(#' + u('soft') + ')"/>');
      s.push('<ellipse cx="136" cy="90" rx="92" ry="34" fill="url(#' + u('bead') + ')"/>');
      s.push('<ellipse cx="242" cy="104" rx="26" ry="13" fill="url(#' + u('bead') + ')"/>');
      s.push('<ellipse cx="104" cy="76" rx="28" ry="8" fill="#ffffff" opacity="0.6" transform="rotate(-8 104 76)"/>');
      s.push('<ellipse cx="234" cy="98" rx="9" ry="3.4" fill="#ffffff" opacity="0.5"/>');
      s.push('<ellipse cx="136" cy="90" rx="92" ry="34" fill="none" stroke="' + rgba(wh, 0.35) + '" stroke-width="1"/>');

    } else if (kind === 'liquid') {
      s.push('<ellipse cx="150" cy="52" rx="86" ry="34" fill="url(#' + u('vap') + ')" opacity="0.5" filter="url(#' + u('soft') + ')"/>');
      s.push('<rect x="116" y="20" width="68" height="116" rx="16" fill="rgba(10,16,26,0.75)"/>');
      s.push('<rect x="120" y="24" width="60" height="52" fill="' + rgba(glow || hi, 0.42) + '"/>');
      s.push('<path d="M120 78 Q150 68 180 78 L180 116 Q180 130 166 130 L134 130 Q120 130 120 116 Z" fill="url(#' + u('liq') + ')"/>');
      s.push('<path d="M120 78 Q150 68 180 78" fill="none" stroke="' + rgba(wh, 0.6) + '" stroke-width="1.4"/>');
      s.push('<rect x="128" y="86" width="7" height="34" rx="3.5" fill="#ffffff" opacity="0.22"/>');
      s.push('<rect x="116" y="20" width="68" height="116" rx="16" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>');
      s.push('<rect x="126" y="30" width="6" height="96" rx="3" fill="#ffffff" opacity="0.13"/>');

    } else if (kind === 'gas') {
      s.push('<rect x="26" y="48" width="248" height="54" rx="27" fill="url(#' + u('gl') + ')" filter="url(#' + u('soft') + ')"/>');
      s.push('<rect x="48" y="60" width="204" height="30" rx="15" fill="url(#' + u('gl') + ')" opacity="0.9"/>');
      s.push('<rect x="66" y="72" width="168" height="6" rx="3" fill="#ffffff" opacity="0.4"/>');
      s.push('<rect x="46" y="58" width="208" height="34" rx="17" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>');
      s.push('<rect x="36" y="65" width="14" height="20" rx="4" fill="#8f9aa8"/>');
      s.push('<rect x="250" y="65" width="14" height="20" rx="4" fill="#8f9aa8"/>');
      s.push('<rect x="52" y="61" width="196" height="10" rx="5" fill="#ffffff" opacity="0.1"/>');

    } else if (kind === 'crystal') {
      s.push('<ellipse cx="152" cy="128" rx="98" ry="11" fill="rgba(0,0,0,0.55)" filter="url(#' + u('soft') + ')"/>');
      s.push('<polygon points="66,112 92,56 130,42 164,70 150,118 100,126" fill="url(#' + u('f1') + ')"/>');
      s.push('<polygon points="92,56 130,42 140,74 106,86" fill="url(#' + u('f2') + ')" opacity="0.85"/>');
      s.push('<polygon points="158,120 176,70 214,58 240,90 226,124 188,130" fill="url(#' + u('f3') + ')"/>');
      s.push('<polygon points="176,70 214,58 220,86 190,96" fill="url(#' + u('f2') + ')" opacity="0.7"/>');
      s.push('<polygon points="112,128 138,104 172,110 178,130" fill="url(#' + u('f1') + ')" opacity="0.9"/>');
      s.push('<rect width="300" height="150" filter="url(#' + u('grain') + ')" opacity="0.07" style="mix-blend-mode:overlay"/>');
      s.push('<polyline points="92,56 130,42 164,70" fill="none" stroke="' + rgba(wh, 0.7) + '" stroke-width="1"/>');
      s.push('<polyline points="176,70 214,58 240,90" fill="none" stroke="' + rgba(wh, 0.5) + '" stroke-width="1"/>');

    } else if (kind === 'graphite') {
      s.push('<ellipse cx="150" cy="128" rx="100" ry="11" fill="rgba(0,0,0,0.6)" filter="url(#' + u('soft') + ')"/>');
      s.push('<polygon points="54,98 92,48 170,36 248,58 238,106 148,126" fill="url(#' + u('f3') + ')"/>');
      s.push('<polygon points="92,48 170,36 180,58 106,72" fill="#cfe0f5" opacity="0.42"/>');
      s.push('<polygon points="112,80 208,62 212,74 118,94" fill="#9fb6d4" opacity="0.18"/>');
      s.push('<polygon points="120,100 224,80 226,88 126,110" fill="#9fb6d4" opacity="0.12"/>');
      s.push('<polyline points="54,98 92,48 170,36 248,58" fill="none" stroke="rgba(226,238,255,0.5)" stroke-width="1"/>');
      s.push('<rect width="300" height="150" filter="url(#' + u('grain') + ')" opacity="0.16" style="mix-blend-mode:overlay"/>');

    } else if (kind === 'powder') {
      s.push('<ellipse cx="150" cy="128" rx="112" ry="11" fill="rgba(0,0,0,0.55)" filter="url(#' + u('soft') + ')"/>');
      s.push('<path d="M40 126 Q86 56 150 52 Q216 50 260 126 Z" fill="url(#' + u('heap') + ')"/>');
      s.push('<rect width="300" height="150" filter="url(#' + u('grain') + ')" opacity="0.34" style="mix-blend-mode:overlay"/>');
      var rnd = seeded(el.z * 31 + 7), i, gx, gy;
      for (i = 0; i < 26; i++) {
        gx = 48 + rnd() * 204;
        gy = 72 + rnd() * 50;
        s.push('<circle cx="' + gx.toFixed(1) + '" cy="' + gy.toFixed(1) + '" r="' + (0.9 + rnd() * 1.6).toFixed(1) +
               '" fill="' + (rnd() < 0.5 ? rgba(wh, 0.45) : rgba(lo, 0.6)) + '"/>');
      }
      s.push('<path d="M40 126 Q86 56 150 52 Q216 50 260 126" fill="none" stroke="' + rgba(wh, 0.28) + '" stroke-width="1"/>');

    } else {
      s.push('<rect x="44" y="34" width="212" height="82" rx="12" fill="#111925"/>');
      s.push('<rect x="44" y="34" width="212" height="82" rx="12" fill="url(#' + u('hatch') + ')"/>');
      s.push('<rect x="44" y="34" width="212" height="82" rx="12" fill="none" stroke="rgba(148,163,184,0.45)" ' +
             'stroke-width="2" stroke-dasharray="7 6"/>');
      s.push('<text x="150" y="88" text-anchor="middle" font-size="34" font-weight="700" fill="#6f819c">?</text>');
      s.push('<text x="150" y="134" text-anchor="middle" font-size="11" fill="#7d90ab">no sample has ever been seen</text>');
    }

    s.push('</svg>');
    return s.join('');
  }

  /* ======================================================================
     THE SHELL DIAGRAM
     ----------------------------------------------------------------------
     Rings from the parsed configuration, electrons spaced evenly around each
     ring. It is a Bohr picture, which is wrong about where electrons are and
     right about how many are in each shell — that is the fact it is here to
     show, and the panel says so underneath it.
     ====================================================================== */
  function bohrSvg(el) {
    var sh = shellsOf(el.cfg);
    var s = [];
    var cx = 120, cy = 120;
    var inner = 40, outer = 112;
    var step = sh.length > 1 ? (outer - inner) / (sh.length - 1) : 0;
    /* Hydrogen and helium have a single shell; parking it at the outer
       radius leaves a huge empty ring around a tiny nucleus, so the lone
       shell is drawn at a sensible middle distance instead. */
    var only = 74;
    var i, k, r, ang, ex, ey;

    s.push('<svg class="pt-svg" viewBox="0 0 240 240" role="img" xmlns="http://www.w3.org/2000/svg">');
    s.push('<defs><radialGradient id="nuc_' + el.z + '" cx="0.35" cy="0.3" r="0.85">' +
           '<stop offset="0" stop-color="#ffd9a8"/><stop offset="0.5" stop-color="#e8763f"/>' +
           '<stop offset="1" stop-color="#8c2f1c"/></radialGradient></defs>');
    s.push('<rect width="240" height="240" rx="10" fill="#080d17"/>');

    for (i = 0; i < sh.length; i++) {
      r = sh.length > 1 ? inner + step * i : only;
      s.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1) +
             '" fill="none" stroke="rgba(125,211,252,0.26)" stroke-width="1"/>');
      for (k = 0; k < sh[i]; k++) {
        ang = (-90 + (360 / sh[i]) * k) * Math.PI / 180;
        ex = cx + r * Math.cos(ang);
        ey = cy + r * Math.sin(ang);
        s.push('<circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) +
               '" r="3.1" fill="#7dd3fc" stroke="#0b1220" stroke-width="0.8"/>');
      }
    }
    s.push('<circle cx="' + cx + '" cy="' + cy + '" r="23" fill="url(#nuc_' + el.z + ')"/>');
    s.push('<text x="' + cx + '" y="' + (cy + 1) + '" text-anchor="middle" font-size="15" font-weight="700" fill="#fff8f0">' +
           el.sym + '</text>');
    s.push('<text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" font-size="10" fill="#ffd9c0">' + el.z + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  /* ======================================================================
     LAYOUT COORDINATES
     ----------------------------------------------------------------------
     Row and column in the drawn grid, which is not the same thing as period
     and group. Rows 1-7 are the periods; row 8 is the gap; rows 9 and 10 are
     the lanthanides and actinides, pulled out and set 15 wide starting at
     column 3 — the conventional layout, and the reason a printed periodic
     table fits on a page instead of being 32 columns across.
     ====================================================================== */
  function coordOf(el) {
    if (el.block === 'f') {
      var base = el.period === 6 ? 57 : 89;
      return { row: el.period === 6 ? 9 : 10, col: 3 + (el.z - base) };
    }
    return { row: el.period, col: el.group };
  }

  function spokenLabel(el) {
    var bits = [el.name, 'symbol ' + el.sym, 'atomic number ' + el.z,
                CATS[el.cat].label.toLowerCase()];
    bits.push(el.group ? 'group ' + el.group : 'no group number');
    bits.push('period ' + el.period);
    return bits.join(', ');
  }

  /* ======================================================================
     THE WIDGET
     ====================================================================== */
  function PT(root) {
    this.root = root;
    this.byZ = {};
    this.cells = [];        // element buttons, in atomic-number order
    this.pos = {};          // 'row:col' -> focusable node, for arrow keys
    this.mode = 'category';
    this.temp = 298;
    this.query = '';
    this.current = null;
    this.tabNode = null;
    this.touched = false;
    this.build();
  }

  /* The stylesheet goes in at parse time rather than when the widget builds,
     which is the one place this differs from cpu.js and processor.js. Two of
     the controls it styles — the find box and the temperature readout — live
     in the page's own toolbar and exist before the consent gate is satisfied.
     Injecting on grant would leave them unstyled until someone clicked. */
  function injectStyle() {
    if (document.getElementById('pt-style')) return;
    var style = document.createElement('style');
    style.id = 'pt-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  PT.prototype.build = function () {
    var self = this, i, el, node, coord;

    var mount = this.root.querySelector('#viz-pt-mount') || this.root;
    mount.textContent = '';

    var wrap = E('div', 'pt-wrap');
    var scroll = E('div', 'pt-scroll');
    var grid = E('div', 'pt-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label',
      'Periodic table, 118 elements. Move with the arrow keys, open an element with Enter.');
    this.grid = grid;

    for (i = 0; i < ELEMENTS.length; i++) {
      el = ELEMENTS[i];
      node = this.makeCell(el);
      coord = coordOf(el);
      node.style.gridColumn = String(coord.col);
      node.style.gridRow = String(coord.row);
      node._pos = coord;
      this.pos[coord.row + ':' + coord.col] = node;
      this.byZ[el.z] = node;
      this.cells.push(node);
      grid.appendChild(node);
    }

    /* The two "57-71" / "89-103" markers that stand in for the pulled-out
       rows. They are real buttons rather than decoration: arrow keys land on
       them like any other cell, and pressing Enter moves focus down into the
       first element of the row they represent. */
    this.addMarker(grid, 6, 3, '57-71', 57,
      'Lanthanides, elements 57 to 71, shown in their own row below. Press Enter to move to lanthanum.');
    this.addMarker(grid, 7, 3, '89-103', 89,
      'Actinides, elements 89 to 103, shown in their own row below. Press Enter to move to actinium.');

    var spacer = E('div', 'pt-frow');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.gridRow = '8';
    grid.appendChild(spacer);

    scroll.appendChild(grid);
    wrap.appendChild(scroll);

    this.legendEl = E('div', 'pt-legend');
    wrap.appendChild(this.legendEl);
    this.noteEl = E('p', 'pt-note');
    wrap.appendChild(this.noteEl);

    this.panel = E('div', 'pt-panel');
    this.panel.setAttribute('aria-live', 'polite');
    wrap.appendChild(this.panel);

    mount.appendChild(wrap);

    grid.addEventListener('click', function (ev) {
      var n = ev.target;
      while (n && n !== grid && !n._pos) n = n.parentNode;
      if (!n || n === grid) return;
      self.activate(n);
    });
    grid.addEventListener('keydown', function (ev) { self.onKey(ev); });
    grid.addEventListener('focusin', function (ev) {
      var n = ev.target;
      while (n && n !== grid && !n._pos) n = n.parentNode;
      if (n && n !== grid) self.setTab(n);
    });

    this.wire();
    this.render();
    this.buildLegend();
    this.select(ELEMENTS[0], false);
    this.setTab(this.cells[0]);
  };

  PT.prototype.makeCell = function (el) {
    var b = E('button', 'pt-cell');
    b.type = 'button';
    b.setAttribute('tabindex', '-1');
    b.setAttribute('aria-label', spokenLabel(el));
    var scrim = E('span', 'pt-scrim');
    scrim.setAttribute('aria-hidden', 'true');
    b.appendChild(scrim);
    b.appendChild(E('span', 'pt-z', String(el.z)));
    b.appendChild(E('span', 'pt-sym', el.sym));
    b.appendChild(E('span', 'pt-nm', el.name));
    var sw = E('span', 'pt-sw');
    sw.setAttribute('aria-hidden', 'true');
    b.appendChild(sw);
    b._el = el;
    b._sw = sw;
    return b;
  };

  PT.prototype.addMarker = function (grid, row, col, label, jumpZ, spoken) {
    var b = E('button', 'pt-ph');
    b.type = 'button';
    b.setAttribute('tabindex', '-1');
    b.setAttribute('aria-label', spoken);
    b.appendChild(E('span', null, label));
    b.style.gridColumn = String(col);
    b.style.gridRow = String(row);
    b._pos = { row: row, col: col };
    b._jump = jumpZ;
    this.pos[row + ':' + col] = b;
    grid.appendChild(b);
  };

  /* ---- interaction ----------------------------------------------------- */

  PT.prototype.setTab = function (node) {
    if (this.tabNode === node) return;
    if (this.tabNode) this.tabNode.setAttribute('tabindex', '-1');
    this.tabNode = node;
    node.setAttribute('tabindex', '0');
  };

  PT.prototype.activate = function (node) {
    if (node._jump) {
      var target = this.byZ[node._jump];
      if (target) { this.setTab(target); target.focus(); this.select(target._el, true); }
      return;
    }
    if (node._el) this.select(node._el, true);
  };

  PT.prototype.step = function (node, dr, dc) {
    var r = node._pos.row, c = node._pos.col, key;
    for (var i = 0; i < 20; i++) {
      r += dr; c += dc;
      if (r < 1 || r > 10 || c < 1 || c > 18) return null;
      key = r + ':' + c;
      if (this.pos[key]) return this.pos[key];
    }
    return null;
  };

  PT.prototype.rowEnd = function (node, dir) {
    var r = node._pos.row, c = dir < 0 ? 1 : 18, found = null;
    for (var i = 0; i < 18; i++) {
      if (this.pos[r + ':' + c]) { found = this.pos[r + ':' + c]; break; }
      c += dir < 0 ? 1 : -1;
    }
    return found;
  };

  PT.prototype.onKey = function (ev) {
    var node = ev.target;
    while (node && node !== this.grid && !node._pos) node = node.parentNode;
    if (!node || node === this.grid) return;

    var next = null;
    var k = ev.key;
    if (k === 'ArrowLeft') next = this.step(node, 0, -1);
    else if (k === 'ArrowRight') next = this.step(node, 0, 1);
    else if (k === 'ArrowUp') next = this.step(node, -1, 0);
    else if (k === 'ArrowDown') next = this.step(node, 1, 0);
    else if (k === 'Home') next = ev.ctrlKey ? this.cells[0] : this.rowEnd(node, -1);
    else if (k === 'End') next = ev.ctrlKey ? this.cells[this.cells.length - 1] : this.rowEnd(node, 1);
    else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      ev.preventDefault();
      this.activate(node);
      return;
    } else return;

    if (!next) return;
    ev.preventDefault();
    this.setTab(next);
    next.focus();
    /* Moving the focus selects, the way a radio group does: the panel is the
       only readout there is, so arrowing around with it frozen would be a
       table you cannot actually read with the keyboard. */
    if (next._el) this.select(next._el, true);
  };

  PT.prototype.select = function (el, user) {
    if (!el) return;
    this.current = el;
    this.render();
    this.renderPanel(el);
    if (user && !this.touched) {
      this.touched = true;
      if (window.KSLab) window.KSLab.used('run');
    }
  };

  /* ---- painting the grid ----------------------------------------------- */

  PT.prototype.modeColour = function (el) {
    if (this.mode === 'block') return BLOCKS[el.block].colour;
    if (this.mode === 'state') return STATES[stateAt(el, this.temp)].colour;
    return CATS[el.cat].colour;
  };

  PT.prototype.render = function () {
    var q = this.query.trim().toLowerCase();
    var appearance = this.mode === 'appearance';
    this.grid.className = 'pt-grid' + (appearance ? ' mode-appearance' : '');

    for (var i = 0; i < this.cells.length; i++) {
      var node = this.cells[i];
      var el = node._el;
      var colour;

      if (appearance) {
        node.style.background = lookCss(el);
        node.style.borderColor = 'rgba(255,255,255,0.16)';
      } else {
        colour = this.modeColour(el);
        node.style.background = mix(colour, [10, 15, 24], 0.62);
        node.style.borderColor = rgba(colour, 0.7);
      }
      node._sw.style.background = lookCss(el);

      var hit = !q ||
        el.name.toLowerCase().indexOf(q) !== -1 ||
        el.sym.toLowerCase().indexOf(q) === 0 ||
        String(el.z) === q ||
        CATS[el.cat].label.toLowerCase().indexOf(q) !== -1;

      node.className = 'pt-cell' + (hit ? '' : ' is-off') + (this.current === el ? ' is-on' : '');
      if (this.current === el) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    }
  };

  PT.prototype.buildLegend = function () {
    var box = this.legendEl, list = [], i, key;
    box.textContent = '';

    if (this.mode === 'category') {
      for (i = 0; i < CAT_ORDER.length; i++) {
        key = CAT_ORDER[i];
        list.push([CATS[key].label, CATS[key].colour]);
      }
      this.noteEl.textContent = 'Colours are the conventional element families. The lanthanides and ' +
        'actinides sit in their own two rows below the table; put them back where their atomic numbers ' +
        'belong and the table would be 32 columns wide.';
    } else if (this.mode === 'block') {
      for (i = 0; i < BLOCK_ORDER.length; i++) {
        key = BLOCK_ORDER[i];
        list.push([BLOCKS[key].label, BLOCKS[key].colour]);
      }
      this.noteEl.textContent = 'Colours show which kind of subshell the outermost electron goes into. ' +
        'The shape of the table is this one fact drawn out: two columns of s, six of p, ten of d, fourteen of f.';
    } else if (this.mode === 'state') {
      for (i = 0; i < STATE_ORDER.length; i++) {
        key = STATE_ORDER[i];
        list.push([STATES[key].label, STATES[key].colour]);
      }
      this.noteEl.textContent = 'Phase at ' + this.temp + ' K (' + celsius(this.temp) + ' °C) and one ' +
        'atmosphere, worked out from the melting and boiling points. Three elements are special cases: ' +
        'carbon and arsenic sublime rather than melt at this pressure, and helium never freezes at it at all. ' +
        'Anything marked unknown has no measured melting or boiling point — that is most of the table above ' +
        'atomic number 100.';
    } else {
      for (i = 0; i < KIND_ORDER.length; i++) {
        key = KIND_ORDER[i];
        list.push([KINDS[key], null, key]);
      }
      this.noteEl.textContent = 'Every tile is drawn from an explicit descriptor — one base colour, a phase ' +
        'and a surface kind — with CSS gradients and SVG. None of it is a photograph, and it is not meant to ' +
        'pass for one; it is meant to be recognisable.';
    }

    for (i = 0; i < list.length; i++) {
      var chip = E('span', 'pt-chip');
      var dot = E('span', 'pt-dot');
      if (list[i][1]) dot.style.background = list[i][1];
      else dot.style.background = lookCss({ z: 20 + i * 7, look: { kind: list[i][2], colour: '#b9bec6' } });
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(list[i][0]));
      box.appendChild(chip);
    }
  };

  /* ---- the detail panel ------------------------------------------------ */

  /* Each term and its value go into their own <div> inside the <dl>. That
     grouping is valid HTML and it is what makes the auto-fit column layout
     work: with bare dt/dd children the grid flows them one per track, so a
     term ends up in one column and its value in the next. */
  function fact(dl, term, value) {
    var row = document.createElement('div');
    row.appendChild(E('dt', null, term));
    if (value == null) row.appendChild(E('dd', 'q', 'unknown'));
    else if (typeof value === 'string') row.appendChild(E('dd', null, value));
    else row.appendChild(value);
    dl.appendChild(row);
  }

  PT.prototype.renderPanel = function (el) {
    var p = this.panel, sh = shellsOf(el.cfg), st = stateAt(el, this.temp);
    p.textContent = '';

    /* --- column one: identity and appearance --- */
    var c1 = E('div', 'pt-col');
    var head = E('div', 'pt-head');
    var badge = E('div', 'pt-badge');
    badge.style.background = lookCss(el);
    var bscrim = E('span', 'pt-scrim');
    bscrim.setAttribute('aria-hidden', 'true');
    bscrim.style.opacity = '1';
    badge.appendChild(bscrim);
    var bsym = document.createElement('b');
    bsym.textContent = el.sym;
    badge.appendChild(bsym);
    var bz = document.createElement('i');
    bz.textContent = String(el.z);
    badge.appendChild(bz);
    head.appendChild(badge);

    var title = E('div', 'pt-title');
    title.appendChild(E('h3', null, el.name));
    title.appendChild(E('p', null, CATS[el.cat].label + ' · ' + el.weight + ' u'));
    head.appendChild(title);
    c1.appendChild(head);

    var swBox = E('div', null);
    swBox.innerHTML = svgSwatch(el);
    var swSvg = swBox.querySelector('svg');
    if (swSvg) swSvg.setAttribute('aria-label', 'Drawn impression of ' + el.name + '. ' + el.look.desc);
    c1.appendChild(swBox);

    var look = E('p', 'pt-look');
    var lb = document.createElement('b');
    lb.textContent = 'Appearance';
    look.appendChild(lb);
    look.appendChild(document.createTextNode(' — ' + el.look.desc));
    c1.appendChild(look);
    c1.appendChild(E('p', 'pt-look', 'Drawn as: ' + KINDS[el.look.kind].toLowerCase() +
      ' · ' + STATES[st].label.toLowerCase() + ' at ' + this.temp + ' K'));

    /* --- column two: the shell diagram --- */
    var c2 = E('div', 'pt-col');
    c2.appendChild(E('p', 'pt-sub', 'Electron shells'));
    var bBox = E('div', null);
    bBox.innerHTML = bohrSvg(el);
    var bSvg = bBox.querySelector('svg');
    if (bSvg) bSvg.setAttribute('aria-label', 'Shell diagram for ' + el.name + ': ' +
      sh.join(', ') + ' electrons, innermost shell first.');
    c2.appendChild(bBox);
    c2.appendChild(E('p', 'pt-shells', sh.join(' · ')));
    c2.appendChild(E('p', 'pt-shells',
      'Drawn from the configuration, not typed in. A Bohr picture is wrong about where electrons are and right about how many are in each shell.'));

    /* --- column three: the numbers --- */
    var c3 = E('div', 'pt-col');
    var dl = E('dl', 'pt-facts');

    fact(dl, 'Atomic number', String(el.z));
    fact(dl, 'Standard atomic weight', el.weight + ' u');
    fact(dl, 'Category', CATS[el.cat].label);
    fact(dl, 'Group', el.group ? String(el.group) : 'f-block, no group number assigned');
    fact(dl, 'Period', String(el.period));
    fact(dl, 'Block', BLOCKS[el.block].label);

    var ddShort = E('dd', 'pt-cfg');
    ddShort.appendChild(cfgNodes(shorthand(el)));
    fact(dl, 'Configuration (shorthand)', ddShort);

    var ddFull = E('dd', 'pt-cfg');
    ddFull.appendChild(cfgNodes(el.cfg));
    fact(dl, 'Configuration (full)', ddFull);

    fact(dl, 'Electronegativity (Pauling)', el.en == null ? null : el.en.toFixed(2));
    fact(dl, 'Atomic radius (empirical)', el.radius == null ? null : el.radius + ' pm');
    fact(dl, 'First ionisation energy', el.ie == null ? null : el.ie + ' kJ/mol');
    fact(dl, 'Melting point', el.melt == null ? (el.subl ? 'does not melt at 1 atm' : null) : kelvinText(el.melt));
    fact(dl, el.subl ? 'Sublimation point' : 'Boiling point', el.boil == null ? null : kelvinText(el.boil));
    fact(dl, 'Density', el.density === 'unknown' ? null : el.density);

    var ddState = E('dd', null, STATES[st].label + ' at ' + this.temp + ' K');
    if (st === 'unknown') ddState.className = 'q';
    this.stateDd = ddState;
    fact(dl, 'State at the chosen temperature', ddState);

    fact(dl, 'Common oxidation states', el.ox);
    fact(dl, 'Discovered', el.year + ' · ' + el.by);
    fact(dl, 'Natural abundance', el.abundance);

    c3.appendChild(dl);

    var use = E('div', 'pt-use');
    var ub = document.createElement('b');
    ub.textContent = 'What it is actually for. ';
    use.appendChild(ub);
    use.appendChild(document.createTextNode(el.use));
    c3.appendChild(use);

    if (el.predicted) {
      c3.appendChild(E('span', 'pt-flag',
        'Predicted, not measured — no weighable sample of this element has ever existed'));
    }

    p.appendChild(c1);
    p.appendChild(c2);
    p.appendChild(c3);
  };

  /* ---- toolbar --------------------------------------------------------- */

  PT.prototype.wire = function () {
    var self = this;

    var mode = document.getElementById('viz-colour');
    if (mode) {
      this.mode = mode.value || 'category';
      mode.addEventListener('change', function () {
        self.mode = mode.value;
        self.render();
        self.buildLegend();
      });
    }

    var temp = document.getElementById('viz-temp');
    var out = document.getElementById('viz-tempout');
    if (temp) {
      this.temp = +temp.value || 298;
      temp.addEventListener('input', function () {
        self.temp = +temp.value;
        if (out) out.textContent = self.temp + ' K · ' + celsius(self.temp) + ' °C';
        /* Only the two things that actually depend on temperature are
           redrawn. Rebuilding the whole panel — two SVGs and a definition
           list — on every tick of a 6500-step slider is a lot of garbage for
           one line of text. */
        if (self.stateDd && self.current) {
          var st = stateAt(self.current, self.temp);
          self.stateDd.textContent = STATES[st].label + ' at ' + self.temp + ' K';
          self.stateDd.className = st === 'unknown' ? 'q' : '';
        }
        if (self.mode === 'state') { self.render(); self.buildLegend(); }
      });
      if (out) out.textContent = this.temp + ' K · ' + celsius(this.temp) + ' °C';
    }

    var find = document.getElementById('viz-search');
    if (find) {
      find.addEventListener('input', function () {
        self.query = find.value;
        self.render();
      });
      find.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        var q = find.value.trim().toLowerCase();
        if (!q) return;
        for (var i = 0; i < ELEMENTS.length; i++) {
          var el = ELEMENTS[i];
          if (el.sym.toLowerCase() === q || el.name.toLowerCase() === q ||
              String(el.z) === q || el.name.toLowerCase().indexOf(q) === 0) {
            self.select(el, true);
            self.setTab(self.byZ[el.z]);
            self.byZ[el.z].focus();
            return;
          }
        }
      });
    }

    var reset = document.getElementById('viz-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        if (mode) { mode.value = 'category'; self.mode = 'category'; }
        if (temp) { temp.value = '298'; self.temp = 298; }
        if (out) out.textContent = '298 K · ' + celsius(298) + ' °C';
        if (find) find.value = '';
        self.query = '';
        self.select(ELEMENTS[0], false);
        self.buildLegend();
        self.setTab(self.cells[0]);
      });
    }
  };

  /* ======================================================================
     BOOT
     ====================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var root = document.getElementById('ptable');
    if (!root) return;
    built = true;
    for (var i = 0; i < ELEMENTS.length; i++) {
      CFG_BY_Z[ELEMENTS[i].z] = ELEMENTS[i].cfg;
      SYM_BY_Z[ELEMENTS[i].z] = ELEMENTS[i].sym;
    }
    // eslint-disable-next-line no-new
    new PT(root);
  }

  injectStyle();

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    // proper path: build only once the Labs consent gate is satisfied
    LabViz.define({ id: 'ptable', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
