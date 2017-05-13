/*
 * @author koko-ng <koko.fr.mu@gmail.com>
 * JSON api beer, only sessionID needs to be given for login -> see webServer
 */

const mongo = require('mongodb').MongoClient,
      app = require('express')(),
      session = require('express-session'),
      MongoStore = require('connect-mongo')(session),
      fs = require('fs'),
      util = require('util')

const beer = require('./lib/beer/index.js');
const account = require('./lib/account/index.js');

exports = module.exports = main;

const tokenRandBytes = 32;

const regEmail = /\S+@\S+\.\S+/;

var db;
var beers,
    users,
    secret,
    options;

/**
 * Server base
 *
 * @namespace Server
 *
 * @param {param} param Parms to be passed to the server
 */
function main(param) {
	util.log('starting server...')

	if(param.database)
		db=param.database;
	else {
		console.log("You must provide a mongoDB database object, exiting..."); process.exit(1);
	}

	if(param.secret)
		secret=param.secret
	else {
		secret = 'secret'; console.log("You must provide a secret in production environment");
	}

	param.port = param.port || 8081
	param.hostname = param.hostname || 'localhost'

	if(!param.url) {
		param.url=param.hostname+':'+param.port; console.log("WARN: Using hostname+':'port for the url")
	}

	if(!param.mailValidation) {
		console.log("You must provide a mail validation function, exiting..."); process.exit(1);
	}

	options=param;
	param=null;

	beers = db.collection('beers');
	users = db.collection('users');

	checkDirectorySync('uploads');
	checkDirectorySync('uploads/144');
	checkDirectorySync('uploads/360');
	checkDirectorySync('uploads/480');
	checkDirectorySync('uploads/720');
	checkDirectorySync('uploads/1080');

	if('development' == app.get('env')) {
		app.use(function(req, res, next) {
			res.header('Access-Control-Allow-Origin', '*');
			res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
			next();
		})
		.use('/sass', require('express').static('sass'));
	}


	app.use(session({
		store: new MongoStore({
			db: db,
			ttl: 864000 //1 day
			}),
		saveUninitialized: false,
		resave: false,
		secret: secret
	}))
	.use(function(req, res, next) {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		next();
	})

	beer(app, beers, options)
	account(app, users, options)

	app.get('/', function (req, res) {
		res.send('Hello ' + req.session.hello)
	})
	.get('/acceptCookies', function (req, res) {
		req.session.save();
		res.send()
	})
	.use('/uploads', require('express').static(__dirname + '/uploads'))
	.listen(options.port, options.hostname)
	util.log('Api server listening on ' + options.hostname + ':' + options.port)
};

//function definitions in parallel of mongo connect


function checkDirectorySync(directory) {
	try {
		fs.statSync(directory);
	} catch(e) {
		fs.mkdirSync(directory);
	}
}

