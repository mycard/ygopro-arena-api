var fs = require('fs');
var _ = require('underscore');
var async = require('async');

var filePath = "./locales/zh-CN/strings.conf"
var filePath2 = "./locales/en-US/strings.conf"

async.parallel([
    function (callback) {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) throw err;
            var strings = data.split("\n")
                .filter((s) => {
                    return s.startsWith("!")
                }).map(s => {
                    let strs = s.split(" ")
                    return { [strs[1]]: strs[2] }
                }).filter((s) => {
                    var key = Object.keys(s)[0]
                    return !isNaN(key) && (key > 1000 && key < 1050)
                })
            callback(null, strings)
        });
    },
    function (callback) {
        fs.readFile(filePath2, 'utf8', (err, data) => {
            if (err) throw err;
            var strings = data.split("\n")
                .filter((s) => {
                    return s.startsWith("!")
                }).map(s => {
                    let strs = s.split(" ")
                    return { [strs[1]]: strs[2] }
                }).filter((s) => {
                    var key = Object.keys(s)[0]
                    return !isNaN(key) && (key > 1000 && key < 1050)
                })
            callback(null, strings)
        });
    }],
    function (err, results) {
        console.log(err)
        console.log(JSON.stringify(results))
    });