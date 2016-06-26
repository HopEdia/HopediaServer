/*
 * @author koko-ng <koko.fr.mu@gmail.com>
 * JSON api beer, only sessionID needs to be given for login -> see webServer
 */

const mongo = require('mongodb').MongoClient,
      assert = require('assert'),
      app = require('express')(),
      session = require('express-session'),
      MongoStore = require('connect-mongo')(session),
      mongo_sanitize = require('mongo-sanitize'),
      bodyParser = require('body-parser'),
      mongo_uuid = require('mongodb').ObjectID,
      sanitizer = require('hopedia_beer_sanitizer'),
      crypto = require('crypto'),
      nodemailer = require('nodemailer'),
      async = require('async'),
      path = require('path')

var util=require('util')

exports = module.exports = main;

const tokenRandBytes = 32;

const regEmail = /\S+@\S+\.\S+/;

var db;
var beers,
    users,
    secret,
    mailer;

const acceptGetProp = ['id', 'name', 'brewery_id', 'abv', 'cat_id', 'ingredients', 'name_completion', 'barcode', 'barcode_format'];
const type = ['bottle', 'can', 'draft'];

function main(options) {
	util.log('starting server...')

	if(options.database)
		db=options.database;
	else {
		console.log("You must provide a mongoDB database object, exiting..."); process.exit(1);
	}

	if(options.secret)
		secret=options.secret
	else {
		secret = 'secret'; console.log("You must provide a secret in production environment");
	}

	options.port = options.port || 8081
	options.hostname = options.hostname || 'localhost'
	mailer = nodemailer.createTransport(options.mailURI); //TODO

	beers = db.collection('beers');
	users = db.collection('users');

	users.createIndex( { "email": 1 }, { unique: true } )
	users.createIndex( { "username": 1 }, { unique: true } )

	//search, if reviews exist modify
	users.createIndex( { "reviews.user": 1 } )

	beers.createIndex({"name._value": "text"})
	//for regex use
	beers.createIndex({"name._value": 1}, { unique: true })

	beers.createIndex({"brewery_id._value": 1})
	beers.createIndex({"abv._value": 1})
	beers.createIndex({"cat_id._value": 1})

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

app.get('/', function (req, res) {
	res.send('Hello ' + req.session.hello)
})
.get('/acceptCookies', function (req, res) {
	req.session.save();
	res.send()
})
.get('/beer', function(req, res) {
	req.body = req.query
	handleBeer(req, res)
})
.post('/beerJSON', bodyParser.json(), handleBeer)
.post('/reviewBeer', bodyParser.json(), function(req, res){
	if(req.body.beerId && req.session.uid && req.body.review) {
		var review = {}

		review.shop = sanitizer.beer.shop(req.body.review.shop)
		review.ebc = sanitizer.beer.shop(req.body.review.ebc)
		review.packaging = sanitizer.beer.packaging(req.body.review.packaging)
		review.taste = sanitizer.beer.scentOrTaste(req.body.review.taste)
		review.scent = sanitizer.beer.scentOrTaste(req.body.review.scent)
		review.remark = sanitizer.beer.remark(req.body.review.remark)
		review.rate = sanitizer.beer.rate(req.body.review.rate)

		review = sanitizer.delete_null_properties(review, true)

		if(review !== {}) {
			//sanitize user input
			req.body.beerId = mongo_uuid(req.body.beerId)

			review.date = new Date();
			review.user = mongo_uuid(req.session.uid);

			beers.updateOne(
				{ _id : req.body.beerId },
				{ $pull: { reviews : {user: review.user } } },
				{ multi: true },
				function(err, result) {
					if(result.matchedCount >= 1) {
						//beer exists
						//insert comment
						beers.updateOne( {'_id': req.body.beerId}, { $push : { 'reviews': review } }, function(err, result) {
							if(result != null)
								res.sendStatus(200)
							else
								res.sendStatus(500)
						})
					}
				}
			);
		}
		//nothing send (empty req or wrong values, check client side)
		else
			res.sendStatus(401)
	}
	else {
		res.sendStatus(401)
	}
})
.post('/editBeer', bodyParser.json(), function(req, res){
	if(req.body._id && req.session.uid) {
		var beer = {}
		console.log(req.session.uid)
		beer.name = sanitizer.beer.name(req.body.name, true, req.session.uid)
		beer.brewery_id = sanitizer.beer.brewery_id(req.body.brewery_id, true, req.session.uid)
		beer.abv = sanitizer.beer.abv(req.body.abv, true, req.session.uid)
		beer.ibu = sanitizer.beer.ibu(req.body.ibu, true, req.session.uid)
		beer.wikidata_id = sanitizer.beer.wikidata_id(req.body.wikidata_id, true, req.session.uid)
		//TODO LOOP
		beer.category = sanitizer.beer.category(req.body.category, true, req.session.uid)
		beer.barcode = sanitizer.beer.barcode(req.body.barcode, true, req.session.uid)
		beer.packaging = sanitizer.beer.packaging(req.body.packaging, true, req.session.uid)

		beer = sanitizer.delete_null_properties(beer, true);

		if(Object.keys(beer).length !== 0) {
			//sanitize user input
			req.body._id = mongo_uuid(req.body._id)

			update = { $push : {} }
			for (var key in beer) {
				// skip loop if the property is from prototype
				if (!beer.hasOwnProperty(key)) continue;
					update.$push[key] = {
								$each: [ beer[key] ],
								$position: 0
							}
			}
			//TODO CHECK DUPPLICATION, see review ??
			beers.updateOne(
				{ _id : req.body._id },
				update,
				{ multi: true },
				function(err, result) {
					console.log(err)
					if(err === null) {
						if(result.matchedCount >= 1)
							res.sendStatus(200);
						else
							res.sendStatus(401)
					}
					else
						res.sendStatus(500)
				}
			);
		}
		//nothing send (empty req or wrong values, check client side)
		else
			res.sendStatus(401)
	}
	else {
		res.sendStatus(401)
	}
})
.post('/insertBeer', bodyParser.json(), function(req, res){
	if(req.session.uid) {
		var beer = {}
		console.log(req.body)
		beer.name = [ sanitizer.beer.name(req.body.name, true, req.session.uid) ]
		beer.brewery_id = [ sanitizer.beer.brewery_id(req.body.brewery_id, true, req.session.uid) ]
		beer.abv = [ sanitizer.beer.abv(req.body.abv, true, req.session.uid) ]
		beer.ibu = [ sanitizer.beer.ibu(req.body.ibu, true, req.session.uid) ]
		beer.wikidata_id = [ sanitizer.beer.wikidata_id(req.body.wikidata_id, true, req.session.uid) ]
		//TODO LOOP
		beer.category = [ sanitizer.beer.category(req.body.category, true, req.session.uid) ]
		beer.barcode = [ sanitizer.beer.barcode(req.body.barcode, true, req.session.uid) ]
		beer.packaging = [ sanitizer.beer.packaging(req.body.packaging, true, req.session.uid) ]

		beer = sanitizer.delete_null_properties(beer, true);

		console.log(beer)
		//TODO, inserts empty array :(
		if(beer !== {} && beer.name) {
			//sanitize user input
			req.body.beerId = mongo_uuid(req.body.beerId)

			beer.type = 'beer';
			beers.insertOne(beer, function(err, result) {
					console.log(err)
					if(err === null) {
						//beer exists & is modified
						res.sendStatus(200);
					}
					//TODO if err contain duplicate ?
					else
						res.sendStatus(500)
				}
			);
		}
		//nothing send (empty req or wrong values, check client side)
		else
			res.sendStatus(401)
	}
	else {
		res.sendStatus(401)
	}
}) //web part
.post('/getToken', bodyParser.json(), function (req, res) {
	if(req.body.password) {
		req.body.password = mongo_sanitize(req.body.password);
		var pass=true;
		delete req.body.newPassword;
	}
	else if(req.body.newPassword) {
		req.body.newPassword = mongo_sanitize(req.body.newPassword);
		var pass=true;
		delete req.body.password;
	}
	else {
		res.sendStatus(401);
		var pass=false;
	}
	if(req.body.username && pass){
		//everything ok
		req.body.username = mongo_sanitize(req.body.username);
		checkCredidential({'username': req.body.username}, req.body.password, req.body.validationToken, res, req.body.newPassword)
	}
	else if (req.body.email && pass) {
		req.body.email = mongo_sanitize(req.body.email);

		checkCredidential({'email': req.body.email}, req.body.password, req.body.validationToken, res, req.body.newPassword)
	}
	else {
		res.sendStatus(401)
	}

})
.post('/login', bodyParser.json(), function(req, res) {
	req.body.token = String(req.body.token);
	if (req.body.token == '')
		res.sendStatus(400)
	else {
		 checkTokenSignature(req.body.token, function(token) {
			var issue = (Date.now()-Number(token[1]))//issued since (in millis)
			//cahnge between 1 day and a lunar revolution (1000millis*60sec*60min*24h*[1|27.3]d)
			if(issue > 86400000 && issue <= 2358720000 ) {
				//REGENERATE long time token & delete old one
				//console.log('Token issued: '+ issue/1000/3600 + ' hour ago.');
				//require ok, node cache
				uid = new require('mongodb').ObjectID(token[0])
				users.updateOne({'_id': uid}, { $pull: { 'tokens': token[2] } }, { 'multi': true }, function(err, result) {
					if(result.modifiedCount >= 1) {
						//new token, insert in db and send it
						//TODO Expiration -> mongodb index & date field
						generateTokenAndRand(token[0], Date.now(), (tok) => {
							//change token in session
							req.session.uid=token[0];
							res.status(200).send(tok);
						});
					}
					else
						res.sendStatus(404)
				});
			}
			else if (issue > 2358720000)
				res.status(401).send('please login again');
			else {
				//valid token
				req.session.uid=token[0]
				res.sendStatus(200)
			}

		},
		function() {
			res.sendStatus(401);
		});
	}
})
.post('/signup', bodyParser.json(), function(req, res) {
	if(!req.session.uid && req.body.email && req.body.username && req.body.password ) {
		//not logged in
		req.body.email = String(req.body.email);
		req.body.username = String(req.body.username);
		req.body.password = String(req.body.password);

		if( /\S+@\S+\.\S+/.test(req.body.email) && req.body.username.length > 2 && req.body.username.length <= 25 && req.body.password.length >= 8 && req.body.password.length <= 75 ){
			//db.users.createIndex( { 'email': 1 }, { unique: true } )
			//db.users.createIndex( { 'username': 1 }, { unique: true } )
			async.parallel([
					function(cb){
						generateToken(crypto.randomBytes(32).toString('hex'), Date.now(), '', function(token) {
							cb(null, token)
						});
					},
					function(cb){
						//512 bit salt
						crypto.randomBytes(64, (err, buf) => {
							cb(err, buf)
						});
					}
				],
				// called once salt & token are generated
				function(err, results){
					// results, Array, 0: verification token, 1: salt
					if(err) {
						res.sendStatus(500)
					}
					else {
						//insert before password, need to check if username & mail are unique
						users.insert({
							'username': mongo_sanitize(req.body.username),
							'password': false,
							'email': mongo_sanitize(req.body.email),
							'verified': results[0],
							'signupDate': Date.now(),
							'salt': results[1]
						}, function(err, resultInsert) {
							if(resultInsert.insertedCount == 1 && err == null) {
								//successfully inserted, begin hash calculation
								hashPass(req.body.password, results[1], function(hash) {
									if (err) throw err;
									users.updateOne({ _id : resultInsert.insertedIds[0] }, { $set: { 'password' : hash.toString('hex') } }, function(err, resultPass) {
										if(resultPass.modifiedCount == 1) {
											// send mail with defined transport object
											//TODO ttl, delete after no answer -> index
											sendValidationToken(results[0], resultInsert.ops[0].email, function(err, info) {
												if(!err)
													res.sendStatus(200);
												else
													res.sendStatus(500);
												});
										}
										else {
											res.sendStatus(422);
										}
									})
								});
							}
							else {
								res.status(422).send(/\$(.*)_\d.*/.exec(err.errmsg)[1]);
							}

						});
					}

				}
			);
		}
		else
			res.sendStatus(422);
	}
	else
		res.sendStatus(401);
})
.post('/resendMailToken', bodyParser.json(), function(req, res) {
	if(req.body.username || req.body.email) {
		generateToken(crypto.randomBytes(32).toString('hex'), Date.now(), '', function(token) {
			if(req.body.username)
				criteria={ 'username' : mongo_sanitize(String(req.body.username)) }
			else if(req.body.email)
				criteria={ 'email' : mongo_sanitize(String(req.body.email)) }
			users.find(criteria).toArray(function(err, docs) {
				if(docs.length == 1) {
					if(docs[0].verified !== true) {
						users.updateOne(criteria, { $set: { 'verified' : token } }, function(err, result) {
							if(result.modifiedCount == 1) {
								// send mail
								sendValidationToken(token, docs[0].email, function(err, info) {
									if(!err)
										res.sendStatus(200);
									else
									req.sendStatus(500);
								});
							}
							else {
								res.sendStatus(500);
							}
						});
					}
					else
						res.sendStatus(422)
				}
				else
					res.sendStatus(401)

			});
		});
	}
	else {
		res.sendStatus(401);
	}
})
.post('/changePassword', bodyParser.json(), function(req, res) {
	if(req.body.email) {
		generateToken(crypto.randomBytes(32).toString('hex'), Date.now(), '', function(token) {
			criteria={ 'email' : mongo_sanitize(String(req.body.email)) }
			users.find(criteria).toArray(function(err, docs) {
				if(docs.length == 1) {
					if(docs[0].verified == true) {
						//TODO TTL
						users.updateOne(criteria, { $set: { 'changePasswordToken' : token } }, function(err, result) {
							if(result.modifiedCount == 1) {
								// send mail //TODO customize mail for pass update
								sendValidationToken(token, docs[0].email, function(err, info) {
									if(!err)
										res.sendStatus(200);
									else
									req.sendStatus(500);
								});
							}
							else {
								res.sendStatus(500);
							}
						});
					}
					else
						res.sendStatus(422)
				}
				else
					res.sendStatus(401)

			});
		});
	}
	else {
		res.sendStatus(401);
	}
})

app.listen(options.port, options.hostname)
util.log('Api server listening on ' + options.hostname + ':' + options.port)
};

//function definitions in parallel of mongo connect

//check name.n._value
const findBeer = function(properties, cb) {
	var json = []
	var find = {}
	Object.keys(properties).forEach(function (value, index, array) {
		switch (value) {
			case 'id':
				find['_id']=mongo_uuid(properties[value]);
				break;
			case 'name':
				find.$text= {$search: properties[value]}
				break;
			case 'name_completion':
				find['name._value']= {$regex: '(?:^| )'+properties[value]+'.*', $options: 'ig'}
				break;
			case 'brewery_id':
			case 'abv':
			case 'cat_id':
				find['cat_id']=properties[value]
				break;
			case 'barcode':
				//if next field is the format
				if(array[index+1] == 'barcode_format') {
					find['barcode._value']=properties[value]
					find['barcode.format']=properties['barcode_format']
				}
				break;
		}
	});
	console.log(find)
	var cursor = beers.find(find, {'reviews': {$slice: 10}}).limit(10);

	cursor.each(function(err, doc) {
		assert.equal(err, null);
		if (doc != null) {
			cb(doc)
		}
		else {
			cb(false);
		}
	});
}

function handleBeer(req, res) {
	for(var i in req.body) {
		if(req.body[i] == 'null') {req.body[i]=null}
		req.body[i]=mongo_sanitize(req.body[i])
		if (acceptGetProp.indexOf(i) < 0){
			delete req.body[i]
		}
	}
	if (req.body != {}) {
		var json = []
		findBeer(req.body, function(obj) {
			if(obj===false){
				res.json(json)
			}
			else {
				json.push(obj)
			}
		});
	}
	else { res.status(403).end(); }
}
//web part
function sign(buf, cb) {
	var hmac = crypto.createHmac('sha256', secret);
	hmac.on('readable', () => {
		var data = hmac.read();
		if (data)
			cb(data);
		});
	hmac.write(buf);
	hmac.end();
}
function generateToken(uid, date, rand, cb) {
	var buf = new Buffer(uid + '\u001f' + String(date) + '\u001f' + rand)
	sign(buf, function(hmac){
		buf = Buffer.concat([buf, new Buffer('\u001d'), hmac]);
		cb(buf.toString('base64'));
	})
}
const hashPass = function(password, salt, cb) {
	crypto.pbkdf2(password, salt, 100000, 512, 'sha512', (err, key) => {
		cb(key.toString('hex'));
	});
}
const checkTokenSignature = function(token, cbTrue, cbFalse) {
	var tok = new Buffer(token, 'base64').toString().split('\u001d')[0].split('\u001f');
	//token, Array, 0: username, 1: time of creation, 2:random bytes
	generateToken(tok[0], tok[1], tok[2], function(result) {
		if(result=== token)
			cbTrue(tok)
		else
			cbFalse(tok)
	})
}
const generateTokenAndRand = function(uid, date, cb) {
	crypto.randomBytes(tokenRandBytes, (err, buff) => {
		buff = buff.toString('hex')
			generateToken(uid, Date.now(), buff, function(token) {
				users.updateOne({'_id': uid}, { $push: { 'tokens': buff } }, function(err, result) {
					cb(token);
				})
			});
		});
	}
function checkCredidential(criteria, password, validationToken, res, newPassword) {
	users.find(criteria).toArray(function(err, docs) {
		if(docs[0] && password) {
			hashPass(password, docs[0].salt.buffer, function(hash) {
				if(hash === docs[0].password && docs[0].verified == true) {
					//generate byte and insert in db
					generateTokenAndRand(docs[0]._id, Date.now(), (token) => {
						res.status(200).send(token);
					});
				}
				//account not verified
				//validationToken is present
				else if(hash === docs[0].password && validationToken) {
					checkTokenSignature(validationToken,
						function(tok) {
							//valid
							//is token equal to the token in db?
							if(validationToken == docs[0].verified && Date.now()-tok[1] < 2358720000 ) {
								users.updateOne({'_id': docs[0]._id}, { $set: { 'verified' : true } }, function(err, result) {
									//generate byte and insert in db
									generateTokenAndRand(docs[0]._id, Date.now(), (token) => {
										res.status(200).send(token);
									});
								});
							}
								else {
								//token id and user id doesn't match
								res.status(401).send('please get a new validation token')
							}

						},
						function(token) {
							//NOT valid
							console.log(token)
							res.sendStatus(401)
						}
					);
				}
				else if(hash === docs[0].password)
					res.status(401).send('please validate your account')
				else
					res.status(401).send("Wrong password or email")
			});
		}
		else if(docs[0] && newPassword && docs[0].verified && validationToken && docs[0].changePasswordToken) {
			//no pass provided -> verify token & insert new password
			checkTokenSignature(validationToken,
				function(tok) {
					//valid
					if(validationToken == docs[0].changePasswordToken && Date.now()-tok[1] < 2358720000 ) {
						//insert the newPassword
						hashPass(newPassword, docs[0].salt.buffer, function(hash) {
							users.updateOne({'_id': docs[0]._id}, { $set: { 'password' : hash }, $unset: { changePasswordToken: "" } }, function(err, result) {
								//generate byte and insert in db
								generateTokenAndRand(docs[0]._id, Date.now(), (token) => {
									res.status(200).send(token);
								});
							});
						});
					}
					else {
						//token id and user id doesn't match
						res.status(401).send('please get a new password token')
					}
				},
				function(token) {
					//NOT valid
					console.log(token)
					res.sendStatus(401)
				}
			);
		}

		else {
			res.sendStatus(404)
		}
	});
}
function sendValidationToken(token, email, cb) {
	mailer.sendMail(// setup e-mail data with unicode symbols
		{//TODO
			from: '\'Fred Foo\' 👥  <smtptestbeer@gmail.com>', // sender address
			to: email,
			subject: 'Hello ✔', // Subject line
			text: 'Hello world 🐴' + token, // plaintext body
			html: '<b>Hello world 🐴' + token + '</b>' // html body
		},
		function(err, info){
			if(err){
				//mail error
				util.log('WARN: mail send error: ' + err)
			}
			cb(err, info)
		});
}
