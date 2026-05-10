const cleanString = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const escapePdfText = (value) => cleanString(value)
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)');

const wrapText = (value, maxLength = 78) => {
  const words = cleanString(value).split(' ').filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });

  if (line) {
    lines.push(line);
  }
  return lines.length ? lines : ['-'];
};

const safeFilenamePart = (value) => cleanString(value).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80) || 'receipt';

class ReceiptPdfService {
  buildPdf({ title = 'Payment receipt', subtitle = '', rows = [] } = {}) {
    const content = ['BT', '/F1 20 Tf', '50 790 Td', `(${escapePdfText(title)}) Tj`];
    let yOffset = -24;

    if (subtitle) {
      content.push('/F1 11 Tf', `0 ${yOffset} Td`, `(${escapePdfText(subtitle)}) Tj`);
      yOffset = -28;
    }

    content.push('/F1 10 Tf');
    rows.forEach((row) => {
      if (!row || (!row.label && !row.value)) {
        yOffset -= 6;
        return;
      }

      const label = cleanString(row.label);
      const wrapped = wrapText(row.value, 72);
      wrapped.forEach((line, index) => {
        const prefix = index === 0 && label ? `${label}: ` : '  ';
        content.push(`0 ${yOffset} Td`, `(${escapePdfText(`${prefix}${line}`)}) Tj`);
        yOffset = -16;
      });
    });
    content.push('ET');

    const stream = content.join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, 'utf8');
  }

  buildAttachment({ filename = '', title = 'Payment receipt', subtitle = '', rows = [] } = {}) {
    return {
      filename: `${safeFilenamePart(filename || title)}.pdf`,
      contentType: 'application/pdf',
      content: this.buildPdf({ title, subtitle, rows })
    };
  }
}

module.exports = new ReceiptPdfService();
