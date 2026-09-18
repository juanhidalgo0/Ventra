import * as fs from 'fs';

function checkTags() {
  const code = fs.readFileSync('c:/Users/PC/Desktop/Kiosco/apps/frontend/src/components/pos/CierreCajaModal.tsx', 'utf8');
  
  // Clean up comments and string literals to avoid false positives
  let cleanCode = code.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '');
  
  // Find all JSX tags
  const tagRegex = /<\/?([a-zA-Z0-9\.]+)(?:\s+[^>]*)?>/g;
  const stack: { tag: string; line: number; col: number }[] = [];
  
  const lines = cleanCode.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    // We need to be careful with regex state
    tagRegex.lastIndex = 0;
    
    // Find all tags in this line
    const lineTags: { tag: string; isClosing: boolean; isSelfClosing: boolean; col: number }[] = [];
    while ((match = tagRegex.exec(line)) !== null) {
      const fullTag = match[0];
      const tagName = match[1];
      
      // Skip TypeScript generic parameters like Promise<void> or Record<string, any>
      if (tagName === 'void' || tagName === 'any' || tagName === 'number' || tagName === 'string' || tagName === 'boolean') {
        continue;
      }
      
      const isClosing = fullTag.startsWith('</');
      const isSelfClosing = fullTag.endsWith('/>') || fullTag.includes('input') || fullTag.includes('br') || fullTag.includes('hr');
      
      lineTags.push({
        tag: tagName,
        isClosing,
        isSelfClosing,
        col: match.index + 1
      });
    }
    
    for (const t of lineTags) {
      if (t.isSelfClosing) {
        continue;
      }
      if (t.isClosing) {
        if (stack.length === 0) {
          console.log(`[Line ${i + 1}:${t.col}] Extra closing tag: </${t.tag}>`);
        } else {
          const last = stack.pop();
          if (last?.tag !== t.tag) {
            console.log(`[Line ${i + 1}:${t.col}] Mismatch: Closed </${t.tag}> but expected </${last?.tag}> (opened at line ${last?.line}:${last?.col})`);
            // Put it back to keep tracking
            if (last) stack.push(last);
          }
        }
      } else {
        stack.push({ tag: t.tag, line: i + 1, col: t.col });
      }
    }
  }
  
  console.log('\n--- Final Stack ---');
  if (stack.length > 0) {
    for (const item of stack) {
      console.log(`<${item.tag}> opened at line ${item.line}:${item.col}`);
    }
  } else {
    console.log('All tags are balanced!');
  }
}

checkTags();
