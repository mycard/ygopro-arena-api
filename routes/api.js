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

var config = require('../db.config')
var cardinfo = require('../cardinfo')

var attrOffset = 1010
var raceOffset = 1020
var typeOffset = 1050

var constants = {
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
var j = schedule.scheduleJob('30 30 0 1 * *', function () {
    console.log('The scheduleJob run on first day of every month!', moment().format('YYYY-MM-DD HH:mm'));

    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }

        var sql = `update user_info set pt = (pt - (pt - 500) * 0.4 )
                    where pt > 500`

        client.query(sql, function (err, result) {
            done()
            if (err) {
                return console.error('error running monthly scheduleJob', err);
            }
            console.log(result)
        });
    })
});

var Filter = require('bad-words-chinese');
var dirtyWords = require('../dirtyWordsChinese.json');
var filter = new Filter({ chineseList: dirtyWords.words });

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
//                 var s = `insert into user_info (username, exp, pt, entertain_win, entertain_lose, entertain_all) values ('${i.username}', '${i.exp}', '${i.pt}', '${i.win}', '${i.lose}', '${i.game}')`
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
    let usernameA = req.body.usernameA
    let usernameB = req.body.usernameB
    let userscoreA = req.body.userscoreA || 0
    let userscoreB = req.body.userscoreB || 0
    let start = req.body.start
    let end = req.body.end
    let arena = req.body.arena || 'entertain'

    if (!usernameA || !usernameB) {
        return res.status(404).send('username can not be null')
    }

    pool.connect(function (err, client, done) {
        if (err) {
            console.error('error fetching client from pool', err);
            return res.status(500).send('database error!')
        }

        var ep = new eventproxy();
        ep.all('query_userA', 'query_userB', function (userA, userB) {
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

                var today = moment().format('YYYY-MM-DD')

                // 真实得分 S（胜=1分，和=0.5分，负=0分）
                let sa = 0, sb = 0
                if (userscoreA > userscoreB) {
                    sa = 1
                    paramA['athletic_win'] = 1
                    paramB['athletic_lose'] = 1
                    winner = usernameA
                }
                if (userscoreA < userscoreB) {
                    sb = 1
                    paramA['athletic_lose'] = 1
                    paramB['athletic_win'] = 1
                    winner = usernameB
                }
                if (userscoreA === userscoreB) {
                    sa = 0.5
                    sb = 0.5
                    paramA['athletic_draw'] = 1
                    paramB['athletic_draw'] = 1
                }

                var queryFirsrWinSql = `select count(*) from battle_history where type ='athletic' and ( (usernameA = '${winner}' AND  userscorea > userscoreb ) OR (usernameB = '${winner}' AND userscoreb > userscorea) ) and start_time > date '${today}' `

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

                    // 3分钟以内结束的决斗，胜者不加DP，负者照常扣DP。 平局不扣DP不加DP   : 把开始时间+3分钟，如果加完比结束时间靠后，说明比赛时间不足三分钟
                    var isLess3Min = moment(start).add(3, 'm').isAfter(moment(end));
                    if (isLess3Min) {
                        if (winner === usernameA) {
                            ptResult.ptA = userA.pt
                            console.log(usernameA, '当局有人存在早退，胜利不加分', moment().format('YYYY-MM-DD HH:mm'))
                        }
                        if (winner === usernameB) {
                            ptResult.ptB = userB.pt
                            console.log(usernameB, '当局有人存在早退，胜利不加分', moment().format('YYYY-MM-DD HH:mm'))
                        }
                    }

                    if (firstWin) {
                        if (winner === usernameA) {
                            ptResult.ptA += 4
                            console.log(usernameA, '首胜多加4DP', moment().format('YYYY-MM-DD HH:mm'))
                        }
                        if (winner === usernameB) {
                            ptResult.ptB += 4
                            console.log(usernameB, '首胜多加4DP', moment().format('YYYY-MM-DD HH:mm'))
                        }
                    }

                    queries.push(`update user_info set exp = ${expResult.expA}, pt = ${ptResult.ptA}, 
                    athletic_win = athletic_win + ${paramA.athletic_win}, 
                    athletic_lose = athletic_lose + ${paramA.athletic_lose}, 
                    athletic_draw = athletic_draw + ${paramA.athletic_draw}, 
                    athletic_all = athletic_all + ${paramA.athletic_all}
                    where username = '${userA.username}'`)

                    queries.push(`update user_info set exp = ${expResult.expB}, pt = ${ptResult.ptB}, 
                    athletic_win = athletic_win + ${paramB.athletic_win}, 
                    athletic_lose = athletic_lose + ${paramB.athletic_lose}, 
                    athletic_draw = athletic_draw + ${paramB.athletic_draw}, 
                    athletic_all = athletic_all + ${paramB.athletic_all}
                    where username = '${userB.username}'`)

                    queries.push(`insert into battle_history values (
                    '${userA.username}',
                    '${userB.username}',
                    '${userscoreA}',
                    '${userscoreB}',
                    '${expResult.expA}',
                    '${expResult.expB}',
                    '${userA.exp}',
                    '${userB.exp}',
                    '${ptResult.ptA}',
                    '${ptResult.ptB}',
                    '${userA.pt}',
                    '${userB.pt}',
                    '${arena}',
                    '${start}',
                    '${end}',
                    '${winner}',
                    '${firstWin}'
                    )`)

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

                queries.push(`update user_info set exp = ${expResult.expA},  
                    entertain_win = entertain_win + ${paramA.entertain_win}, 
                    entertain_lose = entertain_lose + ${paramA.entertain_lose}, 
                    entertain_draw = entertain_draw + ${paramA.entertain_draw}, 
                    entertain_all = entertain_all + ${paramA.entertain_all}
                    where username = '${userA.username}'`)

                queries.push(`update user_info set exp = ${expResult.expB}, 
                    entertain_win = entertain_win + ${paramB.entertain_win}, 
                    entertain_lose = entertain_lose + ${paramB.entertain_lose}, 
                    entertain_draw = entertain_draw + ${paramB.entertain_draw}, 
                    entertain_all = entertain_all + ${paramB.entertain_all}
                    where username = '${userB.username}'`)



                queries.push(`insert into battle_history values (
                    '${userA.username}',
                    '${userB.username}',
                    '${userscoreA}',
                    '${userscoreB}',
                    '${expResult.expA}',
                    '${expResult.expB}',
                    '${userA.exp}',
                    '${userB.exp}',
                    '${userA.pt}',
                    '${userB.pt}',
                    '${userA.pt}',
                    '${userB.pt}',
                    '${arena}',
                    '${start}',
                    '${end}',
                    '${winner}',
                    '${firstWin}'
                    )`)

                queries.map(function (q) {
                    // console.log(q)
                    return client.query(q)
                }).pop().on('end', function () {
                    console.log("finished update score !")
                    done()
                })

            }

        })

        client.query(`select * from user_info where username = '${usernameA}'`).on('end', function (result) {
            done()
            if (result.rows.length > 0) {
                ep.emit('query_userA', result.rows[0])
            } else {
                console.log(`usernameA: ${usernameA} not found `)
                createUser(usernameA, ep, 'query_userA')
            }
        })

        client.query(`select * from user_info where username = '${usernameB}'`).on('end', function (result) {
            done()
            if (result.rows.length > 0) {
                ep.emit('query_userB', result.rows[0])
            } else {
                console.log(`usernameB: ${usernameB} not found `)
                createUser(usernameB, ep, 'query_userB')
            }
        })

        res.json({ msg: 'success' })
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
            sql = 'SELECT * from user_info order by pt desc limit 50'
        } else {
            sql = 'SELECT * from user_info order by exp desc limit 50'
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

                result.category = row.category

                result.type = getStringValueByMysticalNumber(lang, typeOffset, row.type)
                result.race = getStringValueByMysticalNumber(lang, raceOffset, row.race)
                result.attribute = getStringValueByMysticalNumber(lang, attrOffset, row.attribute)

                res.json(result);
            });

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

        var sql = `SELECT * from deck_info where name like  '%${name}%'`
        if (version) {
            sql = `SELECT * from deck_info_history where name = '${name}' and id= ${version}`
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

                sql = `SELECT * from deck_info_history where name = '${resName}' order by start_time desc`
                console.log(sql);
                client.query(sql, function (err, result) {
                    done()
                    response.history = result.rows

                    sql = `SELECT * from deck_demo where name = '${resName}' order by create_time desc`
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

        var sql = `insert into deck_demo (name, author, url, title, file, create_time) values (
                    '${name}',
                    '${author}',
                    '${img_url}',
                    '${title}',
                    '${file}',
                    '${now}'
                    )`;

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

            sql = `insert into deck_info (name, content, start_time) values (
                    '${name}',
                    '${contentStr}',
                    '${now}'
                    )`;
        } else {
            sql = `update deck_info set 
                    content = '${contentStr}', 
                    end_time = '${now}'
                    where name = '${name}'`;
        }

        console.log(sql);

        client.query(sql, function (err, result) {
            done();
            sql = `insert into deck_info_history (name, content, start_time) values (
                    '${name}',
                    '${contentStr}',
                    '${now}'
                    )`;
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
            sql = `SELECT count(*) from battle_history where (usernamea = '${username}' or usernameb = '${username}' ) and type = '${arena}'`
        }

        if (username && !arena) {
            sql = `SELECT count(*) from battle_history where usernamea = '${username}' or usernameb = '${username}' `
        }

        if (!username && arena) {
            sql = `SELECT count(*) from battle_history where type = '${arena}'`
        }

        console.log(sql);

        client.query(sql, function (err, result) {
            var total = result.rows[0].count

            var sql2 = `SELECT * from battle_history order by start_time desc limit ${page_num} offset ${offset}`

            if (username && arena) {
                sql2 = `SELECT * from battle_history where ( usernamea = '${username}' or usernameb = '${username}' ) and type = '${arena}' order by start_time desc limit ${page_num} offset ${offset}`
            }

            if (username && !arena) {
                sql2 = `SELECT * from battle_history where usernamea = '${username}' or usernameb = '${username}' order by start_time desc limit ${page_num} offset ${offset}`
            }

            if (!username && arena) {
                sql2 = `SELECT * from battle_history where type = '${arena}' order by start_time desc limit ${page_num} offset ${offset}`
            }

            console.log(sql2)

            client.query(sql2, function (err, result) {
                //call `done()` to release the client back to the pool
                done()
                if (err) {
                    return console.error('error running query', err)
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
            pt: 500,
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

        client.query(`SELECT * from user_info where username = '${username}'`, function (err, result) {
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

                client.query(`SELECT count(*) from user_info where pt >= ${resultData['pt']}`, function (err, result) {
                    done()
                    resultData['arena_rank'] = result.rows[0]['count']
                    ep.emit('delay', '')
                })

                client.query(`SELECT count(*) from user_info where exp >= ${resultData['exp']}`, function (err, result) {
                    done()
                    resultData['exp_rank'] = result.rows[0]['count']
                    ep.emit('delay', '')
                })

            }
        })
    })

})

createUser = function (username, ep, epEventName) {
    pool.connect(function (err, client, done) {
        let sql = `insert into user_info (username) values ('${username}')`
        console.log(sql)
        client.query(sql, function (err, result) {
            done();
            console.log(`Created account for ${username}`)
            ep.emit(epEventName, {
                username: username,
                exp: 0,
                pt: 500,
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
