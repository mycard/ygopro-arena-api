/**
 * Created by Joe on 16/11/10.
 */
var express = require('express');
var router = express.Router();
var pg = require('pg');
var eventproxy = require('eventproxy');

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
};

//this initializes a connection pool
//it will keep idle connections open for a 30 seconds
//and set a limit of maximum 10 idle clients
var pool = new pg.Pool(config);

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
            sql = 'SELECT * from rating_index number order by pt desc limit 50'
        } else {
            sql = 'SELECT * from rating_index number order by exp desc limit 50'
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

    pool.on('error', function (err, client) {
        // if an error is encountered by a client while it sits idle in the pool
        // the pool itself will emit an error event with both the error and
        // the client which emitted the original error
        // this is a rare occurrence but can happen if there is a network partition
        // between your application and the database, the database restarts, etc.
        // and so you might want to handle it and at least log it out
        console.error('idle client error', err.message, err.stack)

        res.json({message: "error"});
    })
});

router.get('/user', function (req, res) {

    // to run a query we can acquire a client from the pool,
    // run a query on the client, and then return the client to the pool
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('error fetching client from pool', err);
        }
        
        var username = req.query.username ;
        
        if(!username){
            res.json({message: "error, username require"});
            return
        }

        var resultData = {
            'exp': '800',
            'exp_rank': '0',
            'pt': '800',
            'arena_rank': '0',
            'win': '0',
            'lose': '0',
            'draw': '0',
            'all': '0',
            'ratio': '0'
        }

        var sql = `SELECT * from rating_index where username = '${username}'`

        console.log(sql);

        client.query(sql, function (err, result) {
            //call `done()` to release the client back to the pool
            done();
            if (err) {
                return console.error('error running query', err);
            }
            if(result.rows.length === 0){
                res.json({message: "error, user not found"});
            }else {
                var user = result.rows[0]
                resultData['exp'] = user['exp']
                resultData['pt'] = user['pt']
                resultData['win'] = user['win']
                resultData['lose'] = user['lose']
                resultData['all'] = user['game']
                resultData['draw'] = user['game'] - user['lose'] - user['win']
                resultData['ratio'] = (user['win'] / user['game'] * 100 ).toFixed(2)

                var ep = new eventproxy();
                
                ep.after('delay', 2, function (row) {
                    console.log('final:');
                    console.log(resultData);
                    res.json(resultData);
                });
                
                client.query(`SELECT count(*) from rating_index where pt >= ${resultData['pt']}`, function (err, result) {
                    done();
                    if (err) {
                        return console.error('error running query', err);
                    }
                    resultData['arena_rank'] = result.rows[0]['count']
                    ep.emit('delay', '');
                });

                client.query(`SELECT count(*) from rating_index where exp >= ${resultData['exp']}`, function (err, result) {
                    done();
                    if (err) {
                        return console.error('error running query', err);
                    }
                    resultData['exp_rank'] = result.rows[0]['count']
                    ep.emit('delay', '');
                });
                
            }
        });
    });

    pool.on('error', function (err, client) {
        // if an error is encountered by a client while it sits idle in the pool
        // the pool itself will emit an error event with both the error and
        // the client which emitted the original error
        // this is a rare occurrence but can happen if there is a network partition
        // between your application and the database, the database restarts, etc.
        // and so you might want to handle it and at least log it out
        console.error('idle client error', err.message, err.stack)

        res.json({message: "error"});
    })
});

module.exports = router;