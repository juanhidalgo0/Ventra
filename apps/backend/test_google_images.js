const axios = require('axios');

async function testGoogleImages(query) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
    console.log(`[Google Images] Querying "${query}"...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1'
      },
      timeout: 6000
    });
    
    const html = response.data;
    // Look for image source tags like src="https://encrypted-tbn0.gstatic.com/images?q=tbn:..."
    const matches = html.match(/src="(https:\/\/encrypted-tbn0\.gstatic\.com\/images\?q=tbn:[^"]+)"/g);
    if (matches && matches.length > 0) {
      const imageUrls = matches.map(m => m.slice(5, -1));
      console.log(`   ✅ Success! Found ${imageUrls.length} images. First image: ${imageUrls[0]}`);
      return imageUrls[0];
    } else {
      console.log(`   ❌ No images found in HTML`);
      // Let's print a small chunk of HTML to see if it returned a JS challenge
      console.log(html.slice(0, 1000));
    }
  } catch (err) {
    console.log(`   💥 Error: ${err.message}`);
  }
  return null;
}

testGoogleImages('Alikal antiacido');
