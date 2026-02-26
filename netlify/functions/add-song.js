const fs = require('fs');
const path = require('path');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const song = JSON.parse(event.body);
    const songsPath = path.join(__dirname, '../../songs.js');
    let songs = [];
    if (fs.existsSync(songsPath)) {
      const raw = fs.readFileSync(songsPath, 'utf8');
      songs = eval(raw.replace('window.allSongs =', '').replace(';', ''));
    }
    songs.push(song);
    fs.writeFileSync(songsPath, 'window.allSongs = ' + JSON.stringify(songs, null, 2) + ';\n');
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};
