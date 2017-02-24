
var sqlite3 = require('sqlite3').verbose();


var db = new sqlite3.Database('locales/zh-CN/cards.cdb');

db.serialize(function() {
  var result = []
  db.get("SELECT id, name FROM texts limit 10", function(err, row) {
      result.push(row)
      console.log(row)
  });
  console.log(result)
});

db.close();

