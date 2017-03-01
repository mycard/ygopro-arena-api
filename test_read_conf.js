var fs = require('fs');
var _ = require('underscore');
var async = require('async');

var filePath = "./ygopro-database/locales/zh-CN/strings.conf"
var filePath2 = "./ygopro-database/locales/en-US/strings.conf"

async.parallel([
    function (callback) {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) throw err;
            var races = {}
            var strings = data.split("\n")
                .filter((s) => {
                    return s.startsWith("!")
                }).map(s => {
                    let strs = s.split(" ")
                    return  [ strs[1], strs[2] ]
                }).filter((s) => {
                    var key = s[0]
                    return !isNaN(key) && (key > 1019 && key < 1080)
                }).map(s =>{
                     console.log(s)
                     races[s[0]] = s[1]
                })
            callback(null, races)
        });
    },
    function (callback) {
        fs.readFile(filePath2, 'utf8', (err, data) => {
            if (err) throw err;
            var races = {}
            var strings = data.split("\n")
                .filter((s) => {
                    return s.startsWith("!")
                }).map(s => {
                    let strs = s.split(" ")
                    races[strs[1]] = strs[2]
                    return { [strs[1]]: strs[2] }
                }).filter((s) => {
                    var key = Object.keys(s)[0]
                    return !isNaN(key) && (key > 1019 && key < 1080)
                })
            callback(null, races)
        });
    }],
    function (err, results) {
        // console.log(err)
        //console.log(JSON.stringify(results[0]))
    });




// dist = {"1001":"手卡","1002":"怪兽区","1003":"魔法陷阱区","1004":"墓地","1005":"除外","1006":"额外","1007":"叠放","1008":"场地区","1009":"灵摆区","1010":"地","1011":"水","1012":"炎","1013":"风","1014":"光","1015":"暗","1016":"神","1020":"战士","1021":"魔法师","1022":"天使","1023":"恶魔","1024":"不死","1025":"机械","1026":"水","1027":"炎","1028":"岩石","1029":"鸟兽","1030":"植物","1031":"昆虫","1032":"雷","1033":"龙","1034":"兽","1035":"兽战士","1036":"恐龙","1037":"鱼","1038":"海龙","1039":"爬虫","1040":"念动力","1041":"幻神兽","1042":"创造神","1043":"幻龙"}
// data = 32
// arrtOffset = 1010
// raceOffset = 1020
// typeOffset = 1050
// for i in range(32):
//     if (data & (1 << i)):
//         index = offset+ i
//         print(dist[str(index)])
