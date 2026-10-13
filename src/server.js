const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
createApp().then((app) => app.listen(port, () => {
  console.log(`Marley fleet & plant register running on http://localhost:${port} (${require('./db').driverName()} database)`);
})).catch((err) => {
  console.error('Could not start:', err.message);
  process.exit(1);
});
