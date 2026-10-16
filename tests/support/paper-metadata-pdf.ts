/** Authored demonstration paper: no downloaded PDF needed for CI. */
export function createPaperMetadataPdf():Buffer {
  const text=(value:string,x:number,y:number,size:number)=>`BT /F1 ${size} Tf ${x} ${y} Td (${value.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)')}) Tj ET`;
  const stream=[
    text('Demonstration of academic reading',72,710,20),
    text('Alice Researcher and Bob Scholar',72,665,12),
    text('Institute of Science, Demonstration University',72,640,10),
    text('very.long.demonstration.author.address@example.edu',72,620,10),
    text('Abstract',72,570,14),
    text('We consider a method for reliable scientific reading.',72,540,12),
    text('1. Introduction',72,480,14),
    text('We show how our method supports a complete paragraph.',72,450,12),
    text('Journal of Demonstration Science, 2024. DOI: 10.1000/example',72,48,8),
  ].join('\n');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body='%PDF-1.4\n';const offsets:number[]=[];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${obj}\nendobj\n`});
  const end=Buffer.byteLength(body);
  body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${end}\n%%EOF`;
  return Buffer.from(body);
}
