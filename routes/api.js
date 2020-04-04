/**
 * Created by Joe on 16/11/10.
 */
var express = require('express')
var router = express.Router()
var pg = require('pg')
var eventproxy = require('eventproxy')
var utils = require('../utils/utils')
var sqlite3 = require('sqlite3').verbose();
var moment = require('moment')
var _ = require('lodash')
var async = require('async')
var fs = require('fs');
var request = require('superagent');

var config = require('../db.config')
var cardinfo = require('../cardinfo')

var attrOffset = 1010
var raceOffset = 1020
var typeOffset = 1050

var cache = {}

var constants = {
    "TYPES": {
        "TYPE_MONSTER": 1,
        "TYPE_SPELL": 2,
        "TYPE_TRAP": 4,
        "TYPE_NORMAL": 16,
        "TYPE_EFFECT": 32,
        "TYPE_FUSION": 64,
        "TYPE_RITUAL": 128,
        "TYPE_TRAPMONSTER": 256,
        "TYPE_SPIRIT": 512,
        "TYPE_UNION": 1024,
        "TYPE_DUAL": 2048,
        "TYPE_TUNER": 4096,
        "TYPE_SYNCHRO": 8192,
        "TYPE_TOKEN": 16384,
        "TYPE_QUICKPLAY": 65536,
        "TYPE_CONTINUOUS": 131072,
        "TYPE_EQUIP": 262144,
        "TYPE_FIELD": 524288,
        "TYPE_COUNTER": 1048576,
        "TYPE_FLIP": 2097152,
        "TYPE_TOON": 4194304,
        "TYPE_XYZ": 8388608,
        "TYPE_PENDULUM": 16777216,
        "TYPE_SPSUMMON": 33554432,
        "TYPE_LINK": 67108864
    },
    "LINK_MARKERS": {
        "LINK_MARKER_BOTTOM_LEFT": 1,
        "LINK_MARKER_BOTTOM": 2,
        "LINK_MARKER_BOTTOM_RIGHT": 4,
        "LINK_MARKER_LEFT": 8,
        "LINK_MARKER_RIGHT": 32,
        "LINK_MARKER_TOP_LEFT": 64,
        "LINK_MARKER_TOP": 128,
        "LINK_MARKER_TOP_RIGHT": 256
    }
}

//this initializes a connection pool
//it will keep idle connections open for a 30 seconds
//and set a limit of maximum 10 idle clients
var pool = new pg.Pool(config)

//sqlite 
var dbEn = new sqlite3.Database('ygopro-database/locales/en-US/cards.cdb');
var dbCn = new sqlite3.Database('ygopro-database/locales/zh-CN/cards.cdb');

pool.on('error', function (err, client) {
    // if an error is encountered by a client while it sits idle in the pool
    // the pool itself will emit an error event with both the error and
    // the client which emitted the original error
    // this is a rare occurrence but can happen if there is a network partition
    // between your application and the database, the database restarts, etc.
    // and so you might want to handle it and at least log it out
    console.error('idle client error', err.message, err.stack)
})


// cron job 

/**
	*    *    *    *    *    *
	┬    ┬    ┬    ┬    ┬    ┬
	│    │    │    │    │    |
	│    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
	│    │    │    │    └───── month (1 - 12)
	│    │    │    └────────── day of month (1 - 31)
	│    │    └─────────────── hour (0 - 23)
	│    └──────────────────── minute (0 - 59)
	└───────────────────────── second (0 - 59, OPTIONAL)
 */
var schedule = require('node-schedule');
// 每月的1日0点30分30秒触发 ：'30 30 0 1 * *'
var j = schedule.scheduleJob('0 0 0 1 * *', function () {
    console.log('The scheduleJob run on first day of every month!', moment().format('YYYY-MM-DD HH:mm'));


    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        let sql = `update user_info set pt = (pt - (pt - 1000) * 0.5 )
                    where pt > 1000`;

        // Monthly pt reduce will be done in function monthly_user_historical_record()
        //client.query(sql, function (err, result) {
        //    done();
        //    if (err) {
        //        return console.error('error running monthly scheduleJob', err);
        //    }
        //    console.log(result)
        //});
    })

    let time = moment().subtract(1, 'month');
    let season = time.format('YYYY-MM');
    let higher_limit = time.format('YYYY-MM-01 00:00:01');
    let lower_limit = moment().subtract(1, 'day').format('YYYY-MM-DD 23:59:59');
    let base = 1000;
    pool.query('select monthly_user_historical_record($1::text, $2, $3::boolean, true)', [season, base, false], (err, result) => {
        if (err)
            return console.error('error running monthly scheduleJob', err);
        else
            pool.query('select collect_win_lose_rate($1, $2)', [lower_limit, higher_limit], (err, result) => {
                if (err) console.error('error running monthly scheduleJob', err);
            });
    });
});

// cron job 

/**
	*    *    *    *    *    *
	┬    ┬    ┬    ┬    ┬    ┬
	│    │    │    │    │    |
	│    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
	│    │    │    │    └───── month (1 - 12)
	│    │    │    └────────── day of month (1 - 31)
	│    │    └─────────────── hour (0 - 23)
	│    └──────────────────── minute (0 - 59)
	└───────────────────────── second (0 - 59, OPTIONAL)
 */
schedule.scheduleJob('1 1 0 1 1 *', function () {

    console.log('The scheduleJob run on 1 Jan !', moment().format('YYYY-MM-DD HH:mm'));

    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        let sql = `update user_info set pt = 1000`;

        client.query(sql, function (err, result) {
            done();
            if (err) {
                return console.error('error running monthly scheduleJob', err);
            }
            console.log(result)
        });
    })

});


var Filter = require('bad-words-chinese');
var dirtyWords = require('../dirtyWordsChinese.json');
var filter = new Filter({
    chineseList: dirtyWords.words
});

// 数据迁移 rating_index => user_info
// router.get('/mr',function(req,res){
//     pool.connect(function (err, client, done) {
//         if (err) {
//             return console.error('error fetching client from pool', err);
//         }
//         client.query('SELECT * from rating_index number', function (err, result) {
//             done();
//             if (err) {
//                 return console.error('error running query', err);
//             }
//             let count = result.rows.length
//             result.rows.map(function(i) {
//                 var s = {text: `insert into user_info (username, exp, pt, entertain_win, entertain_lose, entertain_all) values ($1, $2, $3, $4, $5, $6)`, values: [i.username, i.exp, i.pt, i.win, i.lose, i.game]}
//                 return client.query(s)
//             }).pop().on('end', function(){
//                 console.log(`Inserted ${count} people`)
//                 client.end();
//             });
//             res.json({msg:'ok',count:count})
//         });
//     });
// })

router.post('/score', function (req, res) {
    let accesskey = req.body.accesskey

    if (config.accesskey !== accesskey) {
        console.error('accesskey error', accesskey)
        return res.status(403).send('accesskey error')
    }

    let usernameA = req.body.usernameA
    let usernameB = req.body.usernameB
    let userscoreA = parseInt(req.body.userscoreA) || 0
    let userscoreB = parseInt(req.body.userscoreB) || 0
    let start = req.body.start
    let end = req.body.end
    let arena = req.body.arena || 'entertain'

    if (userscoreA == -5 && userscoreB == -5) {
        return res.status(200).send('ghost match wont calculate the score.');
    }

    if (!usernameA || !usernameB) {
        return res.status(404).send('username can not be null')
    }

    usernameA = usernameA.replace(/'/g, "");
    usernameB = usernameB.replace(/'/g, "");

    pool.connect(function (err, client, done) {
        if (err) {
            console.error('error fetching client from pool', err);
            return res.status(500).send('database error!')
        }

        var ep = new eventproxy();
        ep.all(['query_userA', 'query_userB'], ['query_deckA', 'query_deckB'], function (userA, userB, deckA, deckB) {
            var queries = []

            let paramA = {
                athletic_win: 0,
                athletic_lose: 0,
                athletic_draw: 0,
                athletic_all: 1,
                entertain_win: 0,
                entertain_lose: 0,
                entertain_draw: 0,
                entertain_all: 1,
            }

            let paramB = {
                athletic_win: 0,
                athletic_lose: 0,
                athletic_draw: 0,
                athletic_all: 1,
                entertain_win: 0,
                entertain_lose: 0,
                entertain_draw: 0,
                entertain_all: 1,
            }
            var winner = "none"
            var firstWin = false


            // athletic = 竞技  entertain = 娱乐 
            if (arena === 'athletic') {

                // select count(*) from battle_history where (usernameA = '爱吉' OR usernameB = '爱吉') and start_time > date '2017-02-09'
                // 日首胜  每日0点开始计算  日首胜的话是额外增加固定4DP

                var today = moment(start).format('YYYY-MM-DD')

                // 真实得分 S（胜=1分，和=0.5分，负=0分）
                let sa = 0,
                    sb = 0
                if (userscoreA > userscoreB || userscoreB === -9) {
                    sa = 1
                    paramA['athletic_win'] = 1
                    paramB['athletic_lose'] = 1
                    winner = usernameA
                } else if (userscoreA < userscoreB || userscoreA === -9) {
                    sb = 1
                    paramA['athletic_lose'] = 1
                    paramB['athletic_win'] = 1
                    winner = usernameB
                } else {
                    sa = 0.5
                    sb = 0.5
                    paramA['athletic_draw'] = 1
                    paramB['athletic_draw'] = 1
                }

                var queryFirsrWinSql = {
                    text: `select count(*) from battle_history where type ='athletic' and userscorea != -5 and userscoreb != -5 and ( (usernameA= $1 AND userscorea > userscoreb ) OR (usernameB= $1 AND userscoreb > userscorea) ) and start_time > $2 `,
                    values: [winner, today]
                }
                console.log(queryFirsrWinSql)

                client.query(queryFirsrWinSql, function (err, result) {
                    done()
                    var total = 0;
                    if (!err) {
                        total = result.rows[0].count - 0
                        if (winner !== "none" && total == 0) {
                            firstWin = true
                        }
                    }
                    let ptResult = utils.getEloScore(userA.pt, userB.pt, sa, sb)
                    let expResult = utils.getExpScore(userA.exp, userB.exp, userscoreA, userscoreB)

                    // 处理开局退房的情况
                    var pre_exit = false;
                    if (userscoreA === -5 || userscoreB === -5) {
                        pre_exit = true;
                        firstWin = false;
                        ptResult.ptA = userA.pt;
                        ptResult.ptB = userB.pt;
                        if (userscoreA === -9) {
                            ptResult.ptA = userA.pt - 2;
                            console.log(usernameA, '开局退房', moment(start).format('YYYY-MM-DD HH:mm'))
                        } else if (userscoreB === -9) {
                            ptResult.ptB = userB.pt - 2;
                            console.log(usernameB, '开局退房', moment(start).format('YYYY-MM-DD HH:mm'))
                        }
                    }

                    //新增记分规则，双方DP差距超过137的话，
                    //按加减8或16处理：高分赢低分 高分加8低分减8，低分赢高分，低分加16，高分减16.
                    if (!pre_exit && userA.pt - userB.pt > 137) {
                        if (winner === usernameA) {
                            ptResult.ptA = userA.pt + 8
                            ptResult.ptB = userB.pt - 8
                            console.log(userA.pt, userB.pt, '当局分差过大,高分赢低分', moment(start).format('YYYY-MM-DD HH:mm'))
                        }

                        if (winner === usernameB) {
                            ptResult.ptA = userA.pt - 15
                            ptResult.ptB = userB.pt + 16
                            console.log(userA.pt, userB.pt, '当局分差过大,低分赢高分', moment(start).format('YYYY-MM-DD HH:mm'))
                        }
                    }

                    if (!pre_exit && userB.pt - userA.pt > 137) {
                        if (winner === usernameA) {
                            ptResult.ptA = userA.pt + 16
                            ptResult.ptB = userB.pt - 15
                            console.log(userA.pt, userB.pt, '当局分差过大,低分赢高分', moment(start).format('YYYY-MM-DD HH:mm'))
                        }

                        if (winner === usernameB) {
                            ptResult.ptA = userA.pt - 8
                            ptResult.ptB = userB.pt + 8
                            console.log(userA.pt, userB.pt, '当局分差过大,高分赢低分', moment(start).format('YYYY-MM-DD HH:mm'))
                        }
                    }

                    // 3分钟以内结束的决斗，胜者不加DP，负者照常扣DP。 平局不扣DP不加DP   : 把开始时间+3分钟，如果加完比结束时间靠后，说明比赛时间不足三分钟
                    var isLess3Min = moment(start).add(1, 'm').isAfter(moment(end));
                    if (!pre_exit && isLess3Min) {
                        if (winner === usernameA) {
                            ptResult.ptA = userA.pt
                            console.log(usernameA, '当局有人存在早退，胜利不加分', moment(start).format('YYYY-MM-DD HH:mm'))
                        }
                        if (winner === usernameB) {
                            ptResult.ptB = userB.pt
                            console.log(usernameB, '当局有人存在早退，胜利不加分', moment(start).format('YYYY-MM-DD HH:mm'))
                        }
                    }

                    // 2018.4.23 0秒的决斗，双方都不扣分 -- 星光
                    // var sametime = start == end
                    // if (sametime) {
                    //     ptResult.ptA = userA.pt;
                    //     ptResult.ptB = userB.pt;
                    //     console.log(usernameA, usernameB, '当局有人决斗时间一样 0s 双方不加分不扣分。', moment(start).format('YYYY-MM-DD HH:mm'))
                    // }

                    if (firstWin) {
                        if (winner === usernameA) {
                            ptResult.ptA += 5
                            console.log(usernameA, '首胜多加5DP', moment(start).format('YYYY-MM-DD HH:mm'))
                        }
                        if (winner === usernameB) {
                            ptResult.ptB += 5
                            console.log(usernameB, '首胜多加5DP', moment(start).format('YYYY-MM-DD HH:mm'))
                        }
                    }

                    queries.push({
                        text: `update user_info set exp = $2, pt = $3, 
                    athletic_win = athletic_win + $4, 
                    athletic_lose = athletic_lose + $5, 
                    athletic_draw = athletic_draw + $6, 
                    athletic_all = athletic_all + $7
                    where username = $1`,
                        values: [userA.username, parseFloat(expResult.expA), parseFloat(ptResult.ptA), parseFloat(paramA.athletic_win), parseFloat(paramA.athletic_lose), parseFloat(paramA.athletic_draw), parseFloat(paramA.athletic_all)]
                    })

                    queries.push({
                        text: `update user_info set exp = $2, pt = $3, 
                    athletic_win = athletic_win + $4, 
                    athletic_lose = athletic_lose + $5, 
                    athletic_draw = athletic_draw + $6, 
                    athletic_all = athletic_all + $7
                    where username = $1`,
                        values: [userB.username, parseFloat(expResult.expB), parseFloat(ptResult.ptB), parseFloat(paramB.athletic_win), parseFloat(paramB.athletic_lose), parseFloat(paramB.athletic_draw), parseFloat(paramB.athletic_all)]
                    })

                    queries.push({
                        text: `insert into battle_history values (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11,
                    $12,
                    $13,
                    $14,
                    $15,
                    $16,
                    $17, 
                    $18,
                    $19
                    )`,
                        values: [userA.username, userB.username, userscoreA, userscoreB, expResult.expA, expResult.expB, userA.exp, userB.exp, ptResult.ptA, ptResult.ptB, userA.pt, userB.pt, arena, start, end, winner, firstWin, deckA, deckB]
                    })

                    queries.map(function (q) {
                        // console.log(q)
                        return client.query(q)
                    }).pop().on('end', function () {
                        console.log("finished update score !")
                        done()
                    })
                });



            } else {
                let expResult = utils.getExpScore(userA.exp, userB.exp, userscoreA, userscoreB)

                if (userscoreA > userscoreB) {
                    paramA['entertain_win'] = 1
                    paramB['entertain_lose'] = 1
                    winner = usernameA
                }
                if (userscoreA < userscoreB) {
                    paramA['entertain_lose'] = 1
                    paramB['entertain_win'] = 1
                    winner = usernameB
                }
                if (userscoreA === userscoreB) {
                    paramA['entertain_draw'] = 1
                    paramB['entertain_draw'] = 1
                }

                queries.push({
                    text: `update user_info set exp = $2,  
                    entertain_win = entertain_win + $3, 
                    entertain_lose = entertain_lose + $4, 
                    entertain_draw = entertain_draw + $5, 
                    entertain_all = entertain_all + $6
                    where username = $1`,
                    values: [userA.username, parseFloat(expResult.expA), parseFloat(paramA.entertain_win), parseFloat(paramA.entertain_lose), parseFloat(paramA.entertain_draw), parseFloat(paramA.entertain_all)]
                })

                queries.push({
                    text: `update user_info set exp = $2, 
                    entertain_win = entertain_win + $3, 
                    entertain_lose = entertain_lose + $4, 
                    entertain_draw = entertain_draw + $5, 
                    entertain_all = entertain_all + $6
                    where username = $1`,
                    values: [userB.username, parseFloat(expResult.expB), parseFloat(paramB.entertain_win), parseFloat(paramB.entertain_lose), parseFloat(paramB.entertain_draw), parseFloat(paramB.entertain_all)]
                })



                queries.push({
                    text: `insert into battle_history values (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $9,
                    $10,
                    $11,
                    $12,
                    $13,
                    $14,
                    $15
                    )`,
                    values: [userA.username, userB.username, userscoreA, userscoreB, expResult.expA, expResult.expB, userA.exp, userB.exp, userA.pt, userB.pt, arena, start, end, winner, firstWin]
                })

                queries.map(function (q) {
                    // console.log(q)
                    return client.query(q)
                }).pop().on('end', function () {
                    console.log("finished update score !")
                    done()
                })

            }

        })

        client.query({
            text: `select * from user_info where username = $1`,
            values: [usernameA]
        }).on('end', function (result) {
            done()
            if (result.rows.length > 0) {
                ep.emit('query_userA', result.rows[0])
            } else {
                console.log(`usernameA: ${usernameA} not found `)
                createUser(usernameA, ep, 'query_userA')
            }
        })

        client.query({
            text: `select * from user_info where username = $1`,
            values: [usernameB]
        }).on('end', function (result) {
            done()
            if (result.rows.length > 0) {
                ep.emit('query_userB', result.rows[0])
            } else {
                console.log(`usernameB: ${usernameB} not found `)
                createUser(usernameB, ep, 'query_userB')
            }
        })

        if (req.body.userdeckA) {
            request.post(process.env.DECK_IDENTIFIER_PATH).type('form').send({
                deck: req.body.userdeckA
            }).then(function (result) {
                ep.emit('query_deckA', result.body.deck);
            }).catch(function (err) {
                console.log(err);
            });
        } else
            ep.emit('query_deckA', "no deck")


        if (req.body.userdeckB) {
            request.post(process.env.DECK_IDENTIFIER_PATH).type('form').send({
                deck: req.body.userdeckB
            }).then(function (result) {
                ep.emit('query_deckB', result.body.deck);
            }).catch(function (err) {
                console.log(err);
            });
        } else
            ep.emit('query_deckB', "no deck")

        res.json({
            msg: 'success'
        })
    })
})

router.get('/users', function (req, res) {

    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }
        // order by what ? default pt
        var o = req.query.o || 'pt';
        var sql;
        if (o === 'pt') {
            sql = 'SELECT * from user_info order by pt desc limit 100'
        } else {
            sql = 'SELECT * from user_info order by exp desc limit 100'
        }

        console.log(sql);

        client.query(sql, function (err, result) {
            //call `done()` to release the client back to the pool
            done();
            if (err) {
                return console.error('error running query', err);
            }
            res.json(result.rows);
        });
    });
});

router.get('/cardinfo', function (req, res) {
    var id = req.query.id
    var lang = req.query.lang || "cn"
    if (!id) {
        return res.status(404).send('card id is required!')
    }
    var db
    if ("cn" === lang) {
        db = dbCn
    } else if ("en") {
        db = dbEn
    }

    var result = {};

    db.serialize(function () {

        db.get(`SELECT name , desc, str1, str2, str3 FROM  texts where id = ${id}`, function (err, row) {

            if (err) {
                console.error(err)
                return res.status(500).send('sqlite error!')
            }
            if (!row) {
                return res.status(404).send('card info not found!')
            }

            result.id = id
            result.name = row.name
            result.desc = row.desc
            result.str1 = row.str1
            result.str2 = row.str2
            result.str3 = row.str3

            db.get(`SELECT * FROM  datas where id = ${id}`, function (err, row) {
                if (err) {
                    console.error(err)
                    return res.status(500).send('sqlite error!')
                }
                if (!row) {
                    return res.status(404).send('card info not found!')
                }

                result.ot = row.ot
                result.alias = row.alias
                result.setcode = row.setcode
                result.atk = row.atk

                result.def = row.def

                // 电子界 特殊处理防御
                if (row.race == 16777216) {


                }

                var cardLevel = "";
                var cardLScale = "";
                var cardRScale = "";

                if (row.level <= 12) {
                    result.level = row.level
                } else {
                    //转化为16位，0x01010004，前2位是左刻度，2-4是右刻度，末2位是等级
                    var levelHex = parseInt(row.level, 10).toString(16);
                    cardLevel = parseInt(levelHex.slice(-2), 16);
                    cardLScale = parseInt(levelHex.slice(-8, -6), 16);
                    cardRScale = parseInt(levelHex.slice(-6, -4), 16);
                    result.level = cardLevel
                    result.cardLScale = cardLScale
                    result.cardRScale = cardRScale
                }


                if (!(row.type & constants.TYPES.TYPE_LINK)) {
                    result.name += " ";
                    result.name += " ";
                } else {
                    // result.name+="[LINK-" + cardLevel + "]";
                    // result.name += " " + (result.atk < 0 ? "?" : result.atk) + "/- ";

                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_TOP_LEFT)
                        result.name += "[↖]";
                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_TOP)
                        result.name += "[↑]";
                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_TOP_RIGHT)
                        result.name += "[↗]";
                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_LEFT)
                        result.name += "[←]";
                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_RIGHT)
                        result.name += "[→]";
                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_BOTTOM_LEFT)
                        result.name += "[↙]";
                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_BOTTOM)
                        result.name += "[↓]";
                    if (result.def & constants.LINK_MARKERS.LINK_MARKER_BOTTOM_RIGHT)
                        result.name += "[↘]";

                    result.def = '-'
                }

                result.category = row.category

                result.type = getStringValueByMysticalNumber(lang, typeOffset, row.type)
                result.race = getStringValueByMysticalNumber(lang, raceOffset, row.race)
                result.attribute = getStringValueByMysticalNumber(lang, attrOffset, row.attribute)

                res.json(result);
            });

        });
    });
});

router.get('/report', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var from_date = moment().format('YYYY-MM-DD')
        var to_date = moment().add(1, 'day').format('YYYY-MM-DD')

        if (req.query.from_date) {
            from_date = moment(req.query.from_date).format('YYYY-MM-DD')
        }

        if (req.query.to_date) {
            to_date = moment(req.query.to_date).format('YYYY-MM-DD')
        }

        const time_args = [`${from_date} 00:00:00`, `${to_date} 00:00:00`];

        async.parallel({
            entertainTotal: function (callback) {
                var sql = `SELECT count(*) from battle_history where type = 'entertain' and start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },

            entertainDisconnect: function (callback) {
                var sql = `SELECT count(*) from battle_history where type = 'entertain' and start_time >= $1 and start_time < $2 and (userscorea<0 or userscoreb<0);`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },

            entertainUsers: function (callback) {
                var sql = `SELECT count(DISTINCT usernamea) from battle_history where type = 'entertain' and start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },

            athleticTotal: function (callback) {
                var sql = `SELECT count(*) from battle_history where type = 'athletic' and start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },

            athleticDisconnect: function (callback) {
                var sql = `SELECT count(*) from battle_history where type = 'athletic' and (userscorea<0 or userscoreb<0) and start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },

            athleticUsers: function (callback) {
                var sql = `SELECT count(DISTINCT usernamea) from battle_history where type = 'athletic' and start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },

            totalActive: function (callback) {
                var sql = `SELECT count(DISTINCT usernamea) from battle_history where  start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },

            //以小时为维度 计算每小时的战斗场数 竞技场
            hourlyAthletic: function (callback) {
                var sql = `SELECT start_time FROM battle_history WHERE type = 'athletic' and start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            },
            //以小时为维度 计算每小时的战斗场数 娱乐场
            hourlyEntertain: function (callback) {
                var sql = `SELECT start_time FROM battle_history WHERE type = 'entertain' and start_time >= $1 and start_time < $2;`
                console.log(sql)
                client.query(sql, time_args, function (err, result) {
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    callback(err, result)
                });
            }
        }, function (err, results) {
            if (err) {
                console.error(err);
            }

            var entertainTotal = results.entertainTotal.rows[0].count;
            var entertainDisconnect = results.entertainDisconnect.rows[0].count;
            var entertainUsers = results.entertainUsers.rows[0].count;
            var athleticTotal = results.athleticTotal.rows[0].count;
            var athleticDisconnect = results.athleticDisconnect.rows[0].count;
            var athleticUsers = results.athleticUsers.rows[0].count;
            var totalActive = results.totalActive.rows[0].count;

            var dateHour = ""
            var h = ""
            var hourlyDataMap = {
                athletic: {},
                entertain: {}
            }
            var hourlyAvgMapAthletic = {}
            var hourlyAvgMapEntertain = {}
            var totalAthletic = 0
            var totalEntertain = 0

            var hourlyAthletic = results.hourlyAthletic.rows;
            _.forEach(hourlyAthletic, function (row) {
                totalAthletic++
                dateHour = moment(row.start_time).format("YYYY-MM-DD HH")
                h = moment(row.start_time).format("H")
                if (hourlyDataMap['athletic'][dateHour]) {
                    hourlyDataMap['athletic'][dateHour]++;
                } else {
                    hourlyDataMap['athletic'][dateHour] = 1;
                }

                if (hourlyAvgMapAthletic[h]) {
                    hourlyAvgMapAthletic[h]++;
                } else {
                    hourlyAvgMapAthletic[h] = 1;
                }
            })
            var hourlyEntertain = results.hourlyEntertain.rows;
            _.forEach(hourlyEntertain, function (row) {
                totalEntertain++
                dateHour = moment(row.start_time).format("YYYY-MM-DD HH")
                h = moment(row.start_time).format("H")
                if (hourlyDataMap['entertain'][dateHour]) {
                    hourlyDataMap['entertain'][dateHour]++;
                } else {
                    hourlyDataMap['entertain'][dateHour] = 1;
                }

                if (hourlyAvgMapEntertain[h]) {
                    hourlyAvgMapEntertain[h]++;
                } else {
                    hourlyAvgMapEntertain[h] = 1;
                }
            })

            var totalDays = moment(to_date).diff(from_date, 'days')

            //饼图
            var legendDataAthletic = [];
            var seriesDataAthletic = [];
            for (var i = 0; i < 24; i++) {
                legendDataAthletic.push(i);
                seriesDataAthletic.push({
                    name: i,
                    avg: ((hourlyAvgMapAthletic[i] || 0) / totalDays).toFixed(2),
                    value: hourlyAvgMapAthletic[i] || 0
                });
            }

            var legendDataEntertain = [];
            var seriesDataEntertain = [];
            for (var i = 0; i < 24; i++) {
                legendDataEntertain.push(i);
                seriesDataEntertain.push({
                    name: i,
                    avg: ((hourlyAvgMapEntertain[i] || 0) / totalDays).toFixed(2),
                    value: hourlyAvgMapEntertain[i] || 0
                });
            }


            res.json({
                entertain: {
                    total: entertainTotal,
                    disconnect: entertainDisconnect,
                    users: entertainUsers
                },
                athletic: {
                    total: athleticTotal,
                    disconnect: athleticDisconnect,
                    users: athleticUsers
                },
                totalActive: totalActive,
                hourlyDataMap: hourlyDataMap,
                totalDays: totalDays,
                totalEntertain: totalEntertain,
                totalAthletic: totalAthletic,
                legendDataAthletic: legendDataAthletic,
                seriesDataAthletic: seriesDataAthletic,
                legendDataEntertain: legendDataEntertain,
                seriesDataEntertain: seriesDataEntertain
            });
        });

    });
});

router.post('/votes', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }
        let id = req.body.id;
        let title = req.body.title;
        let options = req.body.options;
        let start_time = req.body.start_time;
        let end_time = req.body.end_time;
        let status = req.body.status || false;
        let multiple = req.body.multiple || false;
        let max = req.body.max || 2;

        var now = moment().format('YYYY-MM-DD HH:mm');

        var sql = {
            text: `insert into votes (title, options, create_time, start_time, end_time, status, multiple, max) values (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8
                    )`,
            values: [title, options, now, start_time, end_time, status, multiple, max]
        };

        if (id) {
            sql = {
                text: `update votes set 
                    title = $1, 
                    options = $2, 
                    start_time = $3, 
                    end_time = $4, 
                    status = $5,
                    multiple = $6, 
                    max = $7
                    where id = $8`,
                values: [title, options, start_time, end_time, status, multiple, max, id]
            };
        }

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});

router.post('/voteStatus', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }
        let id = req.body.id;
        let status = req.body.status;

        var now = moment().format('YYYY-MM-DD HH:mm')

        var sql = {
            text: `update votes set 
                    status = $1
                    where id = $2`,
            values: [status, id]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});


router.post('/submitVote', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        let user = req.body.user;
        let username = req.body.username;

        if (!user || !username || user == "undefined" || username == "undefined") {
            var response = {};
            response.code = 500;
            res.json(response);
            return
        }

        let voteid = req.body.voteid;
        let opid = req.body.opid;

        let opids = req.body.opids
        let multiple = req.body.multiple;

        var date_time = moment().format('YYYY-MM-DD')
        var create_time = moment().format('YYYY-MM-DD HH:mm')

        var sql1 = ""
        var voteResultSqls = [];

        if (multiple === "true") {
            _.each(opids, function (id) {
                sql1 = {
                    text: `insert into vote_result (vote_id, option_id, userid, date_time, create_time) values (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5
                    )`,
                    values: [voteid, id, user, date_time, create_time]
                };
                voteResultSqls.push(sql1)
            })

        } else {
            sql1 = {
                text: `insert into vote_result (vote_id, option_id, userid, date_time, create_time) values (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5
                    )`,
                values: [voteid, opid, user, date_time, create_time]
            };
            voteResultSqls.push(sql1)
        }


        console.log(voteResultSqls);

        var sql2 = {
            text: `update user_info set 
                    exp = (exp + 1),
                    id = $2
                    where username = $1`,
            values: [username, parseFloat(user)]
        };


        async.waterfall([
            function (callback) {
                async.each(voteResultSqls, function (sql, callback2) {
                    client.query(sql, function (err, result) {
                        done()
                        callback2(err);
                    });
                }, function (err) {
                    callback(err)
                });
            },

            function (callback) {
                console.log(sql2);
                client.query(sql2, function (err, result) {
                    done()
                    callback(err)
                });
            },

        ], function (err) {
            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);

        });


    });
});

router.get('/votes', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {


        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        var username = req.query.username;
        var type = req.query.type;


        var status = undefined
        if (type === '1') {
            status = true
        }
        if (type === '2') {
            status = false
        }

        var from_date = req.query.from_date;
        var to_date = req.query.to_date;

        // page_no 当前页数 page_num 每页展示数
        // offset = (page_no - 1) * page_num 
        // select * from battle_history limit  5 offset 15;
        var page_no = req.query.page || 1
        var page_num = req.query.page_num || 15
        var offset = (page_no - 1) * page_num

        var sql = `SELECT count(*) from votes `
        if (status !== undefined) {
            sql = {
                text: `SELECT count(*) from votes where status=$1`,
                values: [parseFloat(status)]
            }
        }

        console.log(sql);

        client.query(sql, function (err, result) {

            var total = result.rows[0].count

            var sql2 = {
                text: `SELECT * from votes order by create_time desc limit $1 offset $2`,
                values: [parseFloat(page_num), parseFloat(offset)]
            }

            if (status !== undefined) {
                var sql2 = {
                    text: `SELECT * from votes where status=$1 order by create_time desc limit $2 offset $3`,
                    values: [parseFloat(status), parseFloat(page_num), parseFloat(offset)]
                }
            }

            console.log(sql2)

            client.query(sql2, function (err, result) {
                //call `done()` to release the client back to the pool
                done()
                if (err) {
                    return console.error('error running query', err)
                }

                var optionCountMap = {}
                var voteCountMap = {}
                var vates = result.rows;
                async.each(vates, function (vote, callback) {

                    var vateid = vote.id
                    var options = JSON.parse(vote.options)

                    var option_ids = []


                    async.waterfall([
                        function (callback3) {

                            async.each(options, function (option, callback2) {

                                var queryVoteOptionCount = {
                                    text: `SELECT count(*) from vote_result where vote_id=$1 and option_id =$2 `,
                                    values: [vateid, option.key]
                                }

                                option_ids.push(String(option.key))
                                // console.log(queryVoteOptionCount)
                                client.query(queryVoteOptionCount, function (err, result) {
                                    //call `done()` to release the client back to the pool
                                    done()
                                    if (err) {
                                        console.error('error running query', err)
                                    }
                                    optionCountMap[option.key] = result.rows[0].count
                                    callback2();
                                });


                            }, function (err) {
                                if (err) {
                                    console.error("get votes error :", err);
                                }

                                callback3()
                            });
                        },

                        function (callback3) {
                            var id_str = "("
                            _.each(option_ids, function (id) {
                                id_str = id_str + "'" + id + "'" + ","
                            })
                            id_str = id_str.slice(0, -1)
                            id_str = id_str + ")"
                            var queryVoteCount = `SELECT count(DISTINCT userid) from vote_result where vote_id = '${vateid}' and option_id in ${id_str} `
                            console.log(queryVoteCount)
                            client.query(queryVoteCount, function (err, result) {
                                //call `done()` to release the client back to the pool
                                done()
                                if (err) {
                                    console.error('error running query', err)
                                }
                                voteCountMap[vateid] = result.rows[0].count
                                callback3();
                            });

                        }

                    ], function (err) {
                        callback()

                    });





                }, function (err) {

                    if (err) {
                        console.error("get votes error :", err);
                    }

                    res.json({
                        total: total - 0,
                        data: result.rows,
                        voteCountMap: voteCountMap,
                        optionCountMap: optionCountMap
                    });
                });



            });

        });

    });
});


router.get('/vote', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        var user = req.query.user;

        var now = moment().format('YYYY-MM-DD HH:mm:ss')

        // 找出可用投票 1 状态为可用 2 开始时间早于当前时间 3 结束时间大于当前时间 
        var sql1 = {
            text: `SELECT * from votes where status='t' and start_time <= $1 and end_time >= $1 order by create_time desc `,
            values: [now]
        }
        console.log(sql1)
        //找出此user投过的票的vote id， 利用这些vote 过滤已经投过的投票 
        var sql2 = {
            text: `SELECT vote_id from vote_result where userid = $1`,
            values: [user]
        }
        //剩下的投票中随机选一个返回

        async.waterfall([
            function (callback) {

                client.query(sql1, function (err, result) {
                    done()
                    callback(err, result.rows)
                });
            },

            function (rows, callback) {

                client.query(sql2, function (err, result) {
                    done()
                    var voteIds = _.map(result.rows, 'vote_id');
                    callback(err, rows, voteIds)
                });
            },

            function (rows, ids, callback) {
                // console.log(ids)
                var validRow = rows.filter(function (row) {
                    // console.log(row, ids.indexOf(row.id.toString()))
                    return ids.indexOf(row.id.toString()) === -1
                })
                callback(null, validRow);
            }

        ], function (err, validRow) {
            if (err) {
                console.error('error running query', err)
            }

            if (validRow.length > 0) {
                var index = _.random(0, validRow.length)
                res.json({
                    data: validRow[index]
                });
            } else {
                res.json({
                    data: "null"
                });
            }

        });

    });
});


router.get('/deckinfo', function (req, res) {
    var name = req.query.name
    var version = req.query.version

    if (!name) {
        return res.status(404).send('deck name is required!')
    }

    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var sql = {
            text: `SELECT * from deck_info where name like  $1`,
            values: ["%" + (name) + "%"]
        }
        if (version) {
            sql = {
                text: `SELECT * from deck_info_history where name = $1 and id= $2`,
                values: [name, parseFloat(version)]
            }
        }

        console.log(sql);

        client.query(sql, function (err, result) {
            done()

            var response = {};
            if (!result || result.rowCount === 0) {
                response.code = 404
                res.json(response);
            } else {
                response.code = 200
                response.data = result.rows[0]

                var resName = response.data.name

                sql = {
                    text: `SELECT * from deck_info_history where name = $1 order by start_time desc`,
                    values: [resName]
                }
                console.log(sql);
                client.query(sql, function (err, result) {
                    done()
                    response.history = result.rows

                    sql = {
                        text: `SELECT * from deck_demo where name = $1 order by create_time desc`,
                        values: [resName]
                    }
                    console.log(sql);
                    client.query(sql, function (err, result) {
                        done()
                        response.demo = _.map(result.rows, function (row) {
                            row.create_time = moment(row.create_time).format('YYYY-MM-DD')
                            return row
                        })
                        res.json(response);
                    });
                });
            }

        });
    });
});



var file = require("./file.js");

router.post('/upload', file.upload);
router.get('/download/:id', file.download);

router.get('/deckdata/:id', function (req, res) {
    var filename = req.params.id
    var filepath = 'upload/' + filename

    var contents = fs.readFileSync(filepath, 'utf8');

    contents = contents.split(/\r?\n/)

    var main = []
    var extra = []
    var side = []

    var current;

    _.each(contents, function (text) {
        if (text === "#main") {
            current = main
        }
        if (text === "#extra") {
            current = extra
        }
        if (text === "!side") {
            current = side
        }

        if (text === "#main" || text === "#extra" || text === "!side") {
            return
        }

        if (text.indexOf("created") !== -1) {
            return
        }

        if (text.trim() === "") {
            return
        }

        current.push(text)
    })

    main = _.countBy(main, Math.floor);
    extra = _.countBy(extra, Math.floor);
    side = _.countBy(side, Math.floor);

    var mainCardArr = []
    var extraCardArr = []
    var sideCardArr = []

    var masterCardArr = []
    var trapCardArr = []
    var spellCardArr = []

    _.each(main, function (value, key) {
        mainCardArr.push({
            id: key,
            num: value
        })
    })

    _.each(extra, function (value, key) {
        extraCardArr.push({
            id: key,
            num: value
        })
    })

    _.each(side, function (value, key) {
        sideCardArr.push({
            id: key,
            num: value
        })
    })


    var db = dbCn;
    var lang = "cn"
    async.waterfall([

        function (callback) {

            async.each(mainCardArr, function (item, callback2) {

                db.serialize(function () {

                    db.get({
                        text: `SELECT a.id, a.name ,b.type from texts a left JOIN datas b on a.id=b.id  where a.id = $1`,
                        values: [parseFloat(item.id)]
                    }, function (err, row) {

                        if (err) {
                            console.error(err)
                            return callback2();
                        }

                        if (!row) {
                            console.error("card not found in database")
                            item.name = "Not found in database"
                            item.type = "怪兽"
                            return callback2();
                        }

                        item.name = row.name
                        item.type = getStringValueByMysticalNumber(lang, typeOffset, row.type)

                        if (item.type === "怪兽") {
                            masterCardArr.push(item)
                        } else if (item.type === "魔法") {
                            spellCardArr.push(item)
                        } else if (item.type === "陷阱") {
                            trapCardArr.push(item)
                        } else {
                            masterCardArr.push(item)
                        }

                        callback2()
                    });
                });

            }, function (err) {
                callback(err)
            });

        },

        function (callback) {

            async.each(extraCardArr, function (item, callback2) {
                db.serialize(function () {

                    db.get({
                        text: `SELECT a.id, a.name ,b.type from texts a left JOIN datas b on a.id=b.id  where a.id = $1`,
                        values: [parseFloat(item.id)]
                    }, function (err, row) {

                        if (err) {
                            console.error(err)
                            return callback2();
                        }

                        if (!row) {
                            console.error("card not found in database")
                            item.name = "Not found in database"
                            item.type = "怪兽"
                            return callback2();
                        }

                        item.name = row.name
                        item.type = getStringValueByMysticalNumber(lang, typeOffset, row.type)

                        callback2()
                    });
                });
            }, function (err) {
                callback(err)
            });
        },

        function (callback) {
            async.each(sideCardArr, function (item, callback2) {
                db.serialize(function () {

                    db.get({
                        text: `SELECT a.id, a.name ,b.type from texts a left JOIN datas b on a.id=b.id  where a.id = $1`,
                        values: [parseFloat(item.id)]
                    }, function (err, row) {

                        if (err) {
                            console.error(err)
                            return callback2();
                        }

                        if (!row) {
                            console.error("card not found in database")
                            item.name = "Not found in database"
                            item.type = "怪兽"
                            return callback2();
                        }

                        item.name = row.name
                        item.type = getStringValueByMysticalNumber(lang, typeOffset, row.type)

                        callback2()
                    });
                });
            }, function (err) {
                callback(err)
            });
        }

    ], function (err) {

        res.json({
            deck: {
                monster: masterCardArr,
                spells: spellCardArr,
                traps: trapCardArr,
                extra: extraCardArr,
                side: sideCardArr
            }
        });

    });



})

//卡组范例提交

router.post('/deckdemo', function (req, res) {

    let author = req.body.user;
    let title = req.body.title;
    let name = req.body.name;
    let img_url = req.body.url;
    let file = req.body.file || "";

    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var now = moment().format('YYYY-MM-DD HH:mm')

        var sql = {
            text: `insert into deck_demo (name, author, url, title, file, create_time) values (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6
                    )`,
            values: [name, author, img_url, title, file, now]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });

})

router.post('/deckinfo', function (req, res) {

    let author = req.body.user;
    let title = req.body.title;
    let name = req.body.name;
    let desc = req.body.desc;
    let strategy = req.body.strategy;
    let reference = req.body.reference;
    let img_url = req.body.url;

    let isNew = req.body.isNew;

    var content = {
        author: filter.clean(author),
        title: filter.clean(title),
        desc: filter.clean(desc),
        strategy: filter.clean(strategy),
        reference: filter.clean(reference),
        url: img_url
    }

    var contentStr = JSON.stringify(content);
    contentStr = contentStr.replace(/'/g, "''")


    if (!name) {
        return res.status(404).send('deck name is required!')
    }

    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var sql;
        var now = moment().format('YYYY-MM-DD HH:mm')
        if (isNew === "true") {

            sql = {
                text: `insert into deck_info (name, content, start_time) values (
                    $1,
                    $2,
                    $3
                    )`,
                values: [name, contentStr, now]
            };
        } else {
            sql = {
                text: `update deck_info set 
                    content = $1, 
                    end_time = $2
                    where name = $3`,
                values: [contentStr, now, name]
            };
        }

        console.log(sql);

        client.query(sql, function (err, result) {
            done();
            sql = {
                text: `insert into deck_info_history (name, content, start_time) values (
                    $1,
                    $2,
                    $3
                    )`,
                values: [name, contentStr, now]
            };
            console.log(sql);

            client.query(sql, function (err, result) {
                done();

                var response = {};
                console.log(err)
                if (err) {
                    response.code = 500;
                } else {
                    response.code = 200;
                }
                res.json(response);
            });

        });
    });
});

router.get('/history', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var username = req.query.username;
        var type = req.query.type;

        var arena = null //1 athletic 2 entertain

        if (type === '1') {
            arena = 'athletic'
        }
        if (type === '2') {
            arena = 'entertain'
        }

        var from_date = req.query.from_date;
        var to_date = req.query.to_date;

        // page_no 当前页数 page_num 每页展示数
        // offset = (page_no - 1) * page_num 
        // select * from battle_history limit  5 offset 15;
        var page_no = req.query.page || 1
        var page_num = req.query.page_num || 15
        var offset = (page_no - 1) * page_num

        var sql = 'SELECT count(*) from battle_history '

        if (username && arena) {
            sql = {
                text: `SELECT count(*) from battle_history where (usernamea = $1 or usernameb = $1 ) and type = $2`,
                values: [username, arena]
            }
        }

        if (username && !arena) {
            sql = {
                text: `SELECT count(*) from battle_history where usernamea = $1 or usernameb = $1 `,
                values: [username]
            }
        }

        if (!username && arena) {
            sql = {
                text: `SELECT count(*) from battle_history where type = $1`,
                values: [arena]
            }
        }

        console.log(sql);

        client.query(sql, function (err, result) {

            if (err) {
                return console.error('error running query', sql, err);
            }

            var total = result.rows[0].count

            var sql2 = {
                text: `SELECT * from battle_history order by start_time desc limit $1 offset $2`,
                values: [parseFloat(page_num), parseFloat(offset)]
            }

            if (username && arena) {
                sql2 = {
                    text: `SELECT * from battle_history where ( usernamea = $1 or usernameb = $1 ) and type = $2 order by start_time desc limit $3 offset $4`,
                    values: [username, arena, parseFloat(page_num), parseFloat(offset)]
                }
            }

            if (username && !arena) {
                sql2 = {
                    text: `SELECT * from battle_history where usernamea = $1 or usernameb = $1 order by start_time desc limit $2 offset $3`,
                    values: [username, parseFloat(page_num), parseFloat(offset)]
                }
            }

            if (!username && arena) {
                sql2 = {
                    text: `SELECT * from battle_history where type = $1 order by start_time desc limit $2 offset $3`,
                    values: [arena, parseFloat(page_num), parseFloat(offset)]
                }
            }

            console.log(sql2)

            client.query(sql2, function (err, result) {
                //call `done()` to release the client back to the pool
                done()
                if (err) {
                    return console.error('error running query', sql2, err)
                }
                res.json({
                    total: total - 0,
                    data: result.rows
                });
            });
        });
    });
});

router.get('/user', function (req, res) {

    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var username = req.query.username;

        var resultData = {
            exp: 0,
            pt: 1000,
            entertain_win: 0,
            entertain_lose: 0,
            entertain_draw: 0,
            entertain_all: 0,
            entertain_wl_ratio: 0,
            exp_rank: 0,
            athletic_win: 0,
            athletic_lose: 0,
            athletic_draw: 0,
            athletic_all: 0,
            athletic_wl_ratio: 0,
            arena_rank: 0
        }

        if (!username) {
            // return res.status(404).send('username can not be null')
            done();
            return res.json(resultData)
        }

        client.query({
            text: `SELECT * from user_info where username = $1`,
            values: [username]
        }, function (err, result) {
            //call `done()` to release the client back to the pool
            done()
            if (err) {
                return console.error('error running query', err)
            }
            if (result.rows.length === 0) {
                // return res.status(404).send(`username ${username} not found`)
                res.json(resultData)
            } else {
                var user = result.rows[0]
                resultData['exp'] = parseInt(user['exp'])
                resultData['pt'] = parseInt(user['pt'])

                resultData['entertain_win'] = user['entertain_win']
                resultData['entertain_lose'] = user['entertain_lose']
                resultData['entertain_draw'] = user['entertain_draw']
                resultData['entertain_all'] = user['entertain_all']

                entertain_wl_ratio = 0
                if (user['entertain_all'] > 0) {
                    entertain_wl_ratio = (user['entertain_win'] / user['entertain_all'] * 100).toFixed(2)
                }
                resultData['entertain_wl_ratio'] = entertain_wl_ratio

                resultData['athletic_win'] = user['athletic_win']
                resultData['athletic_lose'] = user['athletic_lose']
                resultData['athletic_draw'] = user['athletic_draw']
                resultData['athletic_all'] = user['athletic_all']

                let athletic_wl_ratio = 0
                if (user['athletic_all'] > 0) {
                    athletic_wl_ratio = (user['athletic_win'] / user['athletic_all'] * 100).toFixed(2)
                }
                resultData['athletic_wl_ratio'] = athletic_wl_ratio

                var ep = new eventproxy()

                ep.after('delay', 2, function (row) {
                    // console.log(resultData)
                    res.json(resultData)
                });

                client.query({
                    text: `SELECT count(*) from user_info where pt >= $1`,
                    values: [parseFloat(resultData['pt'])]
                }, function (err, result) {
                    done()
                    resultData['arena_rank'] = result.rows[0]['count']
                    ep.emit('delay', '')
                })

                client.query({
                    text: `SELECT count(*) from user_info where exp >= $1`,
                    values: [parseFloat(resultData['exp'])]
                }, function (err, result) {
                    done()
                    resultData['exp_rank'] = result.rows[0]['count']
                    ep.emit('delay', '')
                })

            }
        })
    })

})

//ads 
router.post('/ads', function (req, res) {

    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }
        let id = req.body.id;
        let name = req.body.name;
        let desc = req.body.desc;
        let imgp = req.body.imgp;
        let imgm = req.body.imgm;
        let clkref = req.body.clkref;
        let implurl = req.body.implurl;
        let clkurl = req.body.clkurl;
        let status = req.body.status || true;
        let type = req.body.type || 1;

        var now = moment().format('YYYY-MM-DD HH:mm')

        var sql = {
            text: `insert into ads (name, desctext, imgp_url, imgm_url, click_ref, click_url, impl_url, status, update_time, create_time, type) values (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $9,
                    $10
                    )`,
            values: [name, desc, imgp, imgm, clkref, clkurl, implurl, status, now, type]
        };

        if (id) {
            sql = {
                text: `update ads set 
                    name = $1, 
                    desctext = $2, 
                    imgp_url = $3, 
                    imgm_url = $4, 
                    click_ref = $5,
                    click_url = $6,
                    impl_url = $7,
                    status = $8,
                    update_time = $9,
                    type = $11
                    where id = $10`,
                values: [name, desc, imgp, imgm, clkref, clkurl, implurl, status, now, id, parseFloat(type)]
            };
        }

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});

router.get('/ads', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {


        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        var username = req.query.username;
        var type = req.query.type;


        var status = undefined
        if (type === '1') {
            status = true
        }
        if (type === '2') {
            status = false
        }

        var from_date = req.query.from_date;
        var to_date = req.query.to_date;

        // page_no 当前页数 page_num 每页展示数
        // offset = (page_no - 1) * page_num 
        // select * from battle_history limit  5 offset 15;
        var page_no = req.query.page || 1
        var page_num = req.query.page_num || 15
        var offset = (page_no - 1) * page_num

        async.waterfall([
            function (callback) {
                var sql = `SELECT count(*) from ads `
                if (status !== undefined) {
                    sql = {
                        text: `SELECT count(*) from ads where status=$1`,
                        values: [parseFloat(status)]
                    }
                }

                console.log(sql);

                client.query(sql, function (err, result) {
                    //call `done()` to release the client back to the pool
                    done()
                    var total = result.rows[0].count
                    callback(err, total)

                });

            },

            function (total, callback) {

                var sql2 = {
                    text: `SELECT * from ads order by create_time desc limit $1 offset $2`,
                    values: [parseFloat(page_num), parseFloat(offset)]
                }

                if (status !== undefined) {
                    var sql2 = {
                        text: `SELECT * from ads where status=$1 order by create_time desc limit $2 offset $3`,
                        values: [parseFloat(status), parseFloat(page_num), parseFloat(offset)]
                    }
                }

                console.log(sql2)

                client.query(sql2, function (err, result) {
                    //call `done()` to release the client back to the pool
                    done()
                    if (err) {
                        return console.error('error running query', err)
                    }

                    var ads = result.rows;

                    callback(err, total, ads)


                });
            },

            function (total, ads, callback) {

                var sql3 = `SELECT config_value from site_config where config_key = 'auto_close_ad'`
                client.query(sql3, function (err, result) {
                    //call `done()` to release the client back to the pool
                    done()

                    var ad_switch = result.rows[0].config_value

                    callback(err, total, ads, ad_switch)

                });
            },


        ], function (err, total, ads, ad_switch) {

            res.json({
                ad_switch: ad_switch === 'true',
                total: total - 0,
                data: ads
            });

        });

    });
});


router.post('/adSwitchChange', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        let status = req.body.status;

        var sql = {
            text: `update site_config set 
                    config_value = $1
                    where config_key = 'auto_close_ad'`,
            values: [status]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});



router.get('/label', function (req, res) {
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        var sql = "select config_value from site_config where config_key = 'label'"
        console.log(sql)

        client.query(sql, function (err, result) {
            done()
            var text = result.rows[0].config_value

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
                response.text = text;
            }
            res.json(response);
        });

    });

});


router.post('/label', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        let labelone = req.body.labelone;


        var sql = {
            text: `update site_config set 
                    config_value = $1
                    where config_key = 'label'`,
            values: [labelone]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});



router.post('/activity', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        let start = req.body.start;
        let end = req.body.end;
        let max = req.body.max;
        let name = req.body.name;

        var activity = {
            start: start,
            end: end,
            max: max,
            name: name,
        }

        var activityStr = JSON.stringify(activity)

        var sql = {
            text: `update site_config set 
                    config_value = $1
                    where config_key = 'activity'`,
            values: [activityStr]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});


router.post('/adsStatus', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }
        let id = req.body.id;
        let status = req.body.status;

        var now = moment().format('YYYY-MM-DD HH:mm')

        var sql = {
            text: `update ads set 
                    status = $1
                    where id = $2`,
            values: [status, id]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            var response = {};
            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});


router.get('/getAd', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        var user = req.query.user;

        var type = req.query.type || 1;

        var now = moment().format('YYYY-MM-DD HH:mm:ss')

        // 可用总数 
        var sql1 = {
            text: `SELECT count(*) from ads where status='t' and type=$1;`,
            values: [type]
        }
        console.log(sql1)

        async.waterfall([
            function (callback) {
                // if (cache.auto_close_ad) {
                // callback(null, cache.auto_close_ad);
                // } else {
                var sql = "select config_value from site_config where config_key = 'auto_close_ad'"
                console.log(sql)
                client.query(sql, function (err, result) {
                    done()
                    cache.auto_close_ad = result.rows[0].config_value
                    callback(err, result.rows[0].config_value);
                });
                // }

            },

            function (auto_close_ad, callback) {

                client.query(sql1, function (err, result) {
                    done()
                    callback(err, auto_close_ad, result.rows)
                });
            },

            function (auto_close_ad, rows, callback) {
                var total = rows[0].count - 0
                //返回随机的一个 
                // SELECT myid FROM mytable OFFSET floor(random()*N) LIMIT 1;
                var sql2 = {
                    text: `SELECT * from ads where status='t' and type=$1 OFFSET floor(random() * $2) LIMIT 1 `,
                    values: [type, parseFloat(total)]
                }
                console.log(sql2)
                client.query(sql2, function (err, result) {
                    done()
                    callback(err, auto_close_ad, result.rows)
                });
            },


        ], function (err, auto_close_ad, validRow) {
            if (err) {
                console.error('error running query', err)
            }

            if (validRow.length > 0) {
                res.json({
                    data: validRow[0],
                    auto_close_ad: auto_close_ad
                });
            } else {
                res.json({
                    data: "null",
                    auto_close_ad: auto_close_ad
                });
            }

        });

    });
});


router.post('/adClick', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }

        let id = req.body.id;

        var response = {};
        if (!id) {
            response.code = 500;
            res.json(response);
            return
        }

        var sql = {
            text: `update ads set 
                    clk = clk + 1
                    where id = $1`,
            values: [id]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});


router.post('/adImpl', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {

        if (err) {
            done()
            return console.error('error fetching client from pool', err);
        }
        let id = req.body.id;

        var response = {};
        if (!id) {
            response.code = 500;
            res.json(response);
            return
        }

        var sql = {
            text: `update ads set 
                    impl = impl + 1
                    where id = $1`,
            values: [id]
        };

        console.log(sql);

        client.query(sql, function (err, result) {
            done();

            if (err) {
                console.log(err)
                response.code = 500;
            } else {
                response.code = 200;
            }
            res.json(response);
        });
    });
});



router.get('/firstwin', function (req, res) {
    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var username = req.query.username;

        async.waterfall([
            function (callback) {
                var sql = "select config_value from site_config where config_key = 'activity'"
                console.log(sql)
                client.query(sql, function (err, result) {
                    done()
                    cache.activity = JSON.parse(result.rows[0].config_value)
                    callback(err, cache.activity);
                });
            },


            function (activity, callback) {
                // var end = activity.end;
                // console.log(end);
                // var xx = moment(end).add(1, 'day').format('YYYY-MM-DD HH:mm')
                // console.log(xx);
                var sql2 = {
                    text: `select count(*) from battle_history where type ='athletic' and isfirstwin='t' and ( (usernameA = $1 AND  userscorea > userscoreb ) OR (usernameB = $1 AND userscoreb > userscorea) ) and start_time > $2  and start_time < $3 `,
                    values: [username, activity.start, activity.end]
                }

                console.log(sql2)
                client.query(sql2, function (err, result) {
                    done()
                    activity.total = result.rows[0].count
                    callback(err, activity);
                });
            },

            function (activity, callback) {
                var today = moment().format('YYYY-MM-DD')

                var sql2 = {
                    text: `select count(*) from battle_history where type ='athletic' and isfirstwin='t' and ( (usernameA = $1 AND  userscorea > userscoreb ) OR (usernameB = $1 AND userscoreb > userscorea) )  and start_time > $2 `,
                    values: [username, today]
                }
                console.log(sql2)
                client.query(sql2, function (err, result) {
                    done()
                    activity.today = result.rows[0].count
                    callback(err, activity);
                });
            },

        ], function (err, activity) {
            res.json(activity);
        });

    });
});





createUser = function (username, ep, epEventName) {
    pool.connect(function (err, client, done) {
        let sql = {
            text: `insert into user_info (username) values ($1)`,
            values: [username]
        }
        console.log(sql)
        client.query(sql, function (err, result) {
            done();
            console.log(`Created account for ${username}`)
            ep.emit(epEventName, {
                username: username,
                exp: 0,
                pt: 1000,
                entertain_win: 0,
                entertain_lose: 0,
                entertain_draw: 0,
                entertain_all: 0,
                athletic_win: 0,
                athletic_lose: 0,
                athletic_draw: 0,
                athletic_all: 0
            })
        })
    })
}

var getStringValueByMysticalNumber = function (lang, offset, number) {
    for (var i = 0; i < 32; i++) {
        if (number & (1 << i)) {
            var index = offset + i
            var key = index.toString()
            return cardinfo[lang][key]
        }
    }
    return ""
}

module.exports = router
