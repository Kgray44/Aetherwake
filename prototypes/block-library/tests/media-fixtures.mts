import { strToU8, zipSync } from 'fflate';

/** Tiny authored synthetic fixtures, no user files or external downloads. */
export function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 56 >>\nstream\nBT /F1 20 Tf 30 350 Td (Synthetic PDF first page) Tj ET\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Length 57 >>\nstream\nBT /F1 20 Tf 30 350 Td (Searchable second page) Tj ET\nendstream',
  ].map(value => value.startsWith('<< /Length') ? value.replace(/\/Length \d+/, '/Length ' + value.split('stream\n')[1].split('\nendstream')[0].length) : value);
  let text = '%PDF-1.4\n', offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(text); text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}
export function docxParts(extra: Record<string, Uint8Array> = {}) {
  return {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/styles.xml': strToU8('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>'),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="unsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Synthetic document</w:t></w:r></w:p><w:p><w:r><w:t>Readable </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r><w:hyperlink r:id="unsafe"><w:r><w:t>source link</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
    ...extra,
  };
}
export const docxFixture = () => zipSync(docxParts());
