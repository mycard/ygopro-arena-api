/**
 * Created by Joe on 16/11/10.
 */
var express = require('express')
var router = express.Router()
var pg = require('pg')
var eventproxy = require('eventproxy')
var utils = require('../utils/utils')
var sqlite3 = require('sqlite3').verbose();


// create a config to configure both pooling behavior
// and client options
// note: all config is optional and the environment variables
// will be read if the config is not present
var config = {
    user: 'mycard', //env var: PGUSER
    database: 'ygopro', //env var: PGDATABASE
    password: 'dn8aSm9yAJx23qWn', //env var: PGPASSWORD
    host: 'postgres.mycard.moe', // Server hosting the postgres database
    port: 5432, //env var: PGPORT
    max: 10, // max number of clients in the pool
    idleTimeoutMillis: 30000, // how long a client is allowed to remain idle before being closed
}

//this initializes a connection pool
//it will keep idle connections open for a 30 seconds
//and set a limit of maximum 10 idle clients
var pool = new pg.Pool(config)

//sqlite 
var dbEn = new sqlite3.Database('locales/en-US/cards.cdb');
var dbCn = new sqlite3.Database('locales/zh-CN/cards.cdb');



pool.on('error', function (err, client) {
    // if an error is encountered by a client while it sits idle in the pool
    // the pool itself will emit an error event with both the error and
    // the client which emitted the original error
    // this is a rare occurrence but can happen if there is a network partition
    // between your application and the database, the database restarts, etc.
    // and so you might want to handle it and at least log it out
    console.error('idle client error', err.message, err.stack)
})

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

            // athletic = 竞技  entertain = 娱乐 
            if (arena === 'athletic') {
                // 真实得分 S（胜=1分，和=0.5分，负=0分）
                let sa = 0, sb = 0
                if (userscoreA > userscoreB) {
                    sa = 1
                    paramA['athletic_win'] = 1
                    paramB['athletic_lose'] = 1
                }
                if (userscoreA < userscoreB) {
                    sb = 1
                    paramA['athletic_lose'] = 1
                    paramB['athletic_win'] = 1
                }
                if (userscoreA === userscoreB) {
                    sa = 0.5
                    sb = 0.5
                    paramA['athletic_draw'] = 1
                    paramB['athletic_draw'] = 1
                }

                let ptResult = utils.getEloScore(userA.pt, userB.pt, sa, sb)
                let expResult = utils.getExpScore(userA.exp, userB.exp, userscoreA, userscoreB)

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
                    '${end}'
                    )`)

            } else {
                let expResult = utils.getExpScore(userA.exp, userB.exp, userscoreA, userscoreB)

                if (userscoreA > userscoreB) {
                    paramA['entertain_win'] = 1
                    paramB['entertain_lose'] = 1
                }
                if (userscoreA < userscoreB) {
                    paramA['entertain_lose'] = 1
                    paramB['entertain_win'] = 1
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
                    '${end}'
                    )`)

            }

            queries.map(function (q) {
                // console.log(q)
                return client.query(q)
            }).pop().on('end', function () {
                console.log("finished update score !")
                done()
            })

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

    var result = {} ;

    db.serialize(function () {
        

        db.get(`SELECT name , desc FROM  texts where id = ${id}`, function (err, row) {
            
            if (err) {
                console.error(err)
                return res.status(500).send('sqlite error!')
            }
            if (!row) {
                return res.status(404).send('card info not found!')
            }

            result.name = row.name
            result.desc = row.desc 

            db.get(`SELECT atk , def FROM  datas where id = ${id}`, function (err, row) {
                if (err) {
                    console.error(err)
                    return res.status(500).send('sqlite error!')
                }
                if (!row) {
                    return res.status(404).send('card info not found!')
                }

                result.atk = row.atk
                result.def = row.def
                res.json(result);
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

module.exports = router