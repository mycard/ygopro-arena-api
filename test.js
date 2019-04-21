"use strict"


var superagent = require('superagent')
var moment = require('moment')
var start = '2018-04-23 09:45:19.000000'
var end = '2018-04-23 09:45:18.000000'
var isLess3Min = moment(start).add(1, 'm').isAfter(moment(end));

console.log(isLess3Min)

var sametime = start == end

console.log(sametime)
// var url = 'https://api.mycard.moe/ygopro/arena/score'
var url = 'http://localhost:3000/api/score'

// var url = 'http://localhost:3000/api/user?username=Joe1991'
// console.log( moment().format())
superagent
    .post(url)
    .send({
        accesskey: "XnvGjNG8jttfjYWhtqtgRfWBtyEwjMaF",
        usernameA: "Joe1991",
        usernameB: "Joe1991gtest",
        userscoreA: 3,
        userscoreB: 2,
        start: moment().format(),
        end: moment().add(6,'m').format(),
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



// var url = 'http://gate-d-wzs.592you.comgate-d-wzs.592you.com/users/login'
// console.log(moment().format())
// superagent
//     .post(url)
//     .send({
//         "\/api\/users\/login": "",
//         "channel": "H5_weixin",
//         "server_ext_for_login":"{\"version\": \"03586d01_977\"}",
//         "code": "06110Di20G5jcG1Dl2i209hZi2010DiB",
//         "is_debug_mode": "false",
//         "plugin_id": "347",
//         "private_key": "BA26F2670407E0B8664DDA544026FA54",
//         "state": "public",
//         "uapi_key": "FA90DD7F-F026-10BD-5B17-CAE9DAB0AAD3",
//         "uapi_secret": "890702b0854094bdd285bf583eff98d3"
//     })
//     .end(function (err, res) {
//         if (err) {
//             console.log(err)
//             return
//         }
//         console.log(res.text)
//     })