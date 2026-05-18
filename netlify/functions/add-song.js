exports.handler = async function () {
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Disabled. Add tracks by editing songs.js in the repository.',
    }),
  };
};
