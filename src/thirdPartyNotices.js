// Third-party notices that MUST travel with every distributed build.
//
// This is the COMPLIANCE MECHANISM, deliberately not a source comment: comments are stripped
// from the production bundle by minification, so a header comment is provenance only. These
// are string literals, so they survive into the shipped JS and are rendered verbatim by the
// Credits screen. MIT requires that "the above copyright notice and this permission notice
// shall be included in all copies or substantial portions of the Software" - an acknowledgement
// ("thanks to X") does not satisfy that; the full notice does.
//
// Adding a dependency whose licence requires notice? Add it here. THIRD-PARTY-NOTICES.md at
// the repo root mirrors this file for the source distribution, and thirdPartyNotices.test.mjs
// fails if the two drift apart.

const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export const THIRD_PARTY_NOTICES = [
  {
    id: 'pokemon-cards-css-pen',
    name: 'Holographic card effect (CSS technique)',
    // The PUBLIC CodePen, which CodePen documents as MIT ("Public pens are automatically MIT
    // licensed") - NOT the author's GitHub repository of the same effect, which is GPL-3.0 and
    // is deliberately not used. See docs/foil/foil-proposal.md §2.
    author: 'simeydotme',
    source: 'https://codepen.io/simeydotme/pen/abYWJdX',
    retrieved: '2026-07-20',
    licence: 'MIT',
    usedFor: "Compendium's foil treatment in the card art viewer is adapted from this technique.",
    text: MIT('simeydotme (https://codepen.io/simeydotme)'),
  },
];

/** The complete notices as one plain-text document - what Credits renders and what the root
 *  THIRD-PARTY-NOTICES.md must contain. */
export function noticesText() {
  return THIRD_PARTY_NOTICES.map((n) => [
    n.name,
    `Author: ${n.author}`,
    `Source: ${n.source}`,
    `Retrieved: ${n.retrieved}`,
    n.usedFor,
    '',
    n.text,
  ].join('\n')).join('\n\n---\n\n');
}
