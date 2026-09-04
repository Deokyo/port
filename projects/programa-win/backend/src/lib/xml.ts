/**
 * Scanner XML com resolucao de NAMESPACE por URI.
 *
 * Motivo de existir: o leitor anterior casava tags por regex dependente de prefixo
 * (`<sheet>`, depois `<x:sheet>`). Isso reprovou o gabarito oficial da Locatelli, que usa
 * `x:`, e continuaria reprovando qualquer arquivo com outro prefixo — que e igualmente valido
 * em OOXML. Prefixo e arbitrario; o que identifica um elemento e o par (URI, localName).
 *
 * Nao e um parser XML completo (nao valida DTD, nao resolve entidades externas) e nao precisa
 * ser: le documentos OOXML ja validados pelo produtor. E deliberadamente um SCANNER e nao uma
 * arvore, porque uma planilha grande nao cabe confortavelmente em memoria como DOM.
 */

export const XMLNS_URI = "http://www.w3.org/2000/xmlns/";

export interface XmlAttribute {
  uri: string;      // "" quando o atributo nao tem prefixo (regra do XML: nao herda default ns)
  local: string;
  value: string;
}

export type XmlToken =
  | { kind: "open" | "self"; uri: string; local: string; attrs: XmlAttribute[] }
  | { kind: "close"; uri: string; local: string }
  | { kind: "text"; value: string };

const ENTITIES: Record<string, string> = {
  lt: "<", gt: ">", amp: "&", quot: '"', apos: "'",
};

export function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? whole;
  });
}

interface RawAttribute { name: string; value: string }

function parseAttributes(source: string): RawAttribute[] {
  const attrs: RawAttribute[] = [];
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    attrs.push({ name: m[1]!, value: decodeXmlText(m[3] ?? m[4] ?? "") });
  }
  return attrs;
}

function split(name: string): { prefix: string; local: string } {
  const at = name.indexOf(":");
  return at < 0
    ? { prefix: "", local: name }
    : { prefix: name.slice(0, at), local: name.slice(at + 1) };
}

/**
 * Percorre o documento emitindo tokens ja resolvidos por namespace.
 * A pilha de escopos acompanha `xmlns` e `xmlns:prefixo` declarados em qualquer profundidade —
 * inclusive no proprio elemento, como faz o gabarito oficial.
 */
export function* scanXml(xml: string): Generator<XmlToken> {
  const scopes: Array<Map<string, string>> = [new Map()];

  const resolve = (prefix: string, isAttribute: boolean): string => {
    if (prefix === "xml") return "http://www.w3.org/XML/1998/namespace";
    if (prefix === "xmlns") return XMLNS_URI;
    // Atributo sem prefixo NAO pertence ao namespace default (XML Namespaces, secao 6.2).
    if (!prefix && isAttribute) return "";
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      const found = scopes[i]!.get(prefix);
      if (found !== undefined) return found;
    }
    return "";
  };

  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf("<", index);
    if (open < 0) break;

    if (open > index) {
      const text = xml.slice(index, open);
      if (text.trim()) yield { kind: "text", value: decodeXmlText(text) };
    }

    if (xml.startsWith("<!--", open)) {
      index = xml.indexOf("-->", open);
      index = index < 0 ? xml.length : index + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open);
      const stop = end < 0 ? xml.length : end;
      yield { kind: "text", value: xml.slice(open + 9, stop) };
      index = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<?", open) || xml.startsWith("<!", open)) {
      const end = xml.indexOf(">", open);
      index = end < 0 ? xml.length : end + 1;
      continue;
    }

    const end = xml.indexOf(">", open);
    if (end < 0) break;
    const inner = xml.slice(open + 1, end);
    index = end + 1;

    if (inner.startsWith("/")) {
      const { prefix, local } = split(inner.slice(1).trim());
      const uri = resolve(prefix, false);
      scopes.pop();
      yield { kind: "close", uri, local };
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^\s*([A-Za-z_:][-A-Za-z0-9_:.]*)/.exec(body);
    if (!nameMatch) continue;
    const rawAttrs = parseAttributes(body.slice(nameMatch[0].length));

    // Declaracoes do proprio elemento valem para ele mesmo: entram no escopo antes de resolver.
    const scope = new Map<string, string>();
    for (const attr of rawAttrs) {
      if (attr.name === "xmlns") scope.set("", attr.value);
      else if (attr.name.startsWith("xmlns:")) scope.set(attr.name.slice(6), attr.value);
    }
    scopes.push(scope);

    const { prefix, local } = split(nameMatch[1]!);
    const uri = resolve(prefix, false);
    const attrs: XmlAttribute[] = rawAttrs
      .filter((a) => a.name !== "xmlns" && !a.name.startsWith("xmlns:"))
      .map((a) => {
        const parts = split(a.name);
        return { uri: resolve(parts.prefix, true), local: parts.local, value: a.value };
      });

    if (selfClosing) {
      scopes.pop();
      yield { kind: "self", uri, local, attrs };
    } else {
      yield { kind: "open", uri, local, attrs };
    }
  }
}

/** Busca de atributo por (URI, localName). `uri` vazio casa atributo sem prefixo. */
export function attributeValue(
  attrs: readonly XmlAttribute[], local: string, uri = "",
): string | null {
  const found = attrs.find((a) => a.local === local && a.uri === uri);
  return found ? found.value : null;
}

/** Atributo por localName, ignorando o namespace. Util quando o produtor varia o prefixo. */
export function attributeAnyNs(
  attrs: readonly XmlAttribute[], local: string,
): string | null {
  const found = attrs.find((a) => a.local === local);
  return found ? found.value : null;
}
