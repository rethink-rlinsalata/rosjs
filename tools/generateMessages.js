const rosnodejs = require('../index.js');
rosnodejs.loadAllPackages()
.then(() => {
  console.log('Message generation complete!');
  process.exit();
})
.catch((err) => {
  console.error('Error while generating messages!');
  process.exit(1)
});