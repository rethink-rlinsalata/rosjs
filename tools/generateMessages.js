const rosnodejs = require('../index.js');
rosnodejs.loadAllPackages()
.then(() => {
  console.log('Message generation complete!');
  process.exit();
});