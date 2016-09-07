const rosnodejs = require('../index.js');
const args = process.argv;

if (args.length === 3) {
  rosnodejs.loadPackage(args[2]);
}
else {
  rosnodejs.loadAllPackages()
  .then(() => {
    console.log('Message generation complete!');
    process.exit();
  })
  .catch((err) => {
    console.error('Error while generating messages!');
    process.exit(1)
  });
}