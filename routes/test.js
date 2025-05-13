// test.js
const bcrypt = require('bcryptjs');
async function test() {
  const hash = "$2a$10$UYsmHHVUY2IgyKVA0.HIWuFo2rAv.SOg40rM7CFbNiF0Juje/6Vle";

  console.log('Match:', await bcrypt.compare('password12345', hash));
}
test();