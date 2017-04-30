"use strict"


var superagent = require('superagent')
var mement = require('moment')


var url = 'https://mycard.moe/ygopro/api/score'
// var url = 'http://localhost:3000/api/score'
superagent
    .post(url)
    .send({
        accesskey: "XnvGjNG8jttfjYWhtqtgRfWBtyEwjMaF",
        usernameA: "Joe1991",
        usernameB: "zh99998",
        userscoreA: 1,
        userscoreB: 2,
        start: mement().format(),
        end: mement().format(),
        arena: 'athletic' // 'athletic' 竞技 or 'entertain' 娱乐
    })
    .end(function (err, res) {
        if (err) {
            console.log(err)
            return
        }
        console.log(res.text)
    })

// var Utils = require('./utils/utils')

// console.log("pt test: ptA 1613 ,ptB 1573 draw => ", Utils.getEloScore(1613, 1573, 0.5, 0.5))

// console.log("exp test: expA 100 ,expB 50 A win => ", Utils.getExpScore(100, 50, 2, 1))
// console.log("exp test: expA 100 ,expB 50 B win => ", Utils.getExpScore(100, 50, 1, 2))
// console.log("exp test: expA 100 ,expB 50 draw => ", Utils.getExpScore(100, 50, 2, 2))

// console.log("exp test: expA 5 ,expB 5 A win => ", Utils.getExpScore(5, 5, 2, 1))
// console.log("exp test: expA 5 ,expB 5 B win => ", Utils.getExpScore(5, 5, 1, 2))
// console.log("exp test: expA 5 ,expB 5  draw => ", Utils.getExpScore(5, 5, 2, 2))
