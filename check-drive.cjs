const fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function check() {
  const ids = ['1DLstMOwsStQGHBB1Pm7SD6jZ4JysG8c9', '1MibMsPiM6X6i0uYCQBQYSLzTYdA9ITnz'];
  for (const id of ids) {
    try {
      const res = await fetch(`https://drive.google.com/file/d/${id}/view?usp=sharing`);
      const text = await res.text();
      const title = text.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
      const desc = text.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
      const video = text.match(/<meta property="og:video[^"]*" content="([^"]+)"/)?.[1];
      console.log('ID:', id);
      console.log('Status:', res.status);
      console.log('Title:', title);
      console.log('Description:', desc);
      console.log('Video:', video);
      console.log('---');
    } catch (err) {
      console.error(id, err);
    }
  }
}

check();
