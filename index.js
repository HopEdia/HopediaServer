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
      path = require('path'),
      fs = require('fs'),
      gm = require('gm');

var util=require('util')

exports = module.exports = main;

const tokenRandBytes = 32;

const regEmail = /\S+@\S+\.\S+/;

var db;
var beers,
    users,
    secret,
    mailer,
    options;

const acceptGetProp = ['id', 'name', 'brewery_id', 'abv', 'cat_id', 'ingredients', 'name_completion', 'barcode', 'barcode_format'];
const type = ['bottle', 'can', 'draft'];

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

	param.mailValidation = param.mailValidation || sendValidationToken;

	options=param;
	param=null;
	mailer = nodemailer.createTransport(options.mailURI); //TODO

	beers = db.collection('beers');
	users = db.collection('users');

	users.createIndex( { "email": 1 }, { unique: true } )
	users.createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $exists: true } } } )

	//search, if reviews exist modify
	users.createIndex( { "reviews.user": 1 } )

	beers.createIndex({"name._value": "text"})
	//for regex use
	beers.createIndex({"name._value": 1}, { unique: true })

	beers.createIndex({"brewery_id._value": 1})
	beers.createIndex({"abv._value": 1})
	beers.createIndex({"cat_id._value": 1})

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
						beers.updateOne(
							{'_id': req.body.beerId},
							{
								$push : { 'reviews': {
										$each: [ review ],
										$position: 0
										}
									}
							}, function(err, result) {
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

			var update = { $push : {} }
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
						console.log(result)
						if(result.matchedCount >= 1)
							insertImage(req.body._id, req, res)
						else
							res.sendStatus(401)
					}
					else
						res.sendStatus(500)
				}
			);
		}
		else if(req.body.image === true) {
			console.log(req.body._id)
			insertImage(req.body._id, req, res)

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
		beer.images = [ ]

		beer = sanitizer.delete_null_properties(beer, true);

		if(beer !== {} && beer.name && beer.name[0]) {

			beer.type = 'beer';
			beers.insertOne(beer, function(err, result) {
					console.log(err)
					if(err === null) {
						insertImage(result.insertedId, req, res)
					}
					//TODO reinforce regex
					else
						res.status(400).send(/\$(.*)_\d.*/.exec(err.errmsg)[1])
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
.put('/uploadImage/:objectId', bodyParser.raw({limit: '250kb', type: 'image/jpeg'}), function (req, res) {
	var beerId = req.params.objectId.slice(0, -8);
	// If there's an error
	if(!req.body || !req.session.uid || !req.is('image/jpeg')){
		res.sendStatus(400)
	}
	else {
		beers.update(
			{ _id: mongo_uuid(beerId) },
			{ $pull: { images: { _value: req.params.objectId } } },
			{ multi: true },
			function(err, result) {
				console.log(result.result.nModified)
				resize(req.body, req.params.objectId, function(err, width) {
					console.log(err)
					if (err) res.sendStatus(500);
					else res.sendStatus(200)
					pushImage(beerId, req.params.objectId, req.session.uid, null, width)
			})
		});
		/*var cursor = beers.aggregate([
			{$match : {_id: mongo_uuid(beerId)}},
			{ $project:
				{ images:
					{ $filter: { input: "$images", as: "image",
						cond: { $eq: [ "$$image._value", req.params.objectId ] }
						}
					}
				}
			}
		]);
		cursor.get(function(err, result) {
			console.log(result)
			console.log(err)
			if(result.length==1 && err === null) {
				if(result[0].images.length > 0) {
					if(result[0].images[0].user.toString() === req.session.uid && result[0].images[0]._value===req.params.objectId) {
						resize(req.body, req.params.objectId, function(err, width) {
							if (err) res.sendStatus(500);
							else res.sendStatus(200)
							console.log(1)
							cursor.forEach(function (doc) {
								console.log(doc)
								/*return {
									"updateOne": {
										"filter": { "_id": doc._id } ,
										"update": { "$set": { "nb_orders_1year": doc.count } }
									}
								};/
							});
							/*var bulkOps = db.collection('tmp_indicators').find().map(function (doc) {
								console.log(doc)
								return {
									"updateOne": {
										"filter": { "_id": doc._id } ,
										"update": { "$set": { "nb_orders_1year": doc.count } }
									}
								};
							});
							db.clients.bulkWrite(bulkOps, { "ordered": true });/
						})
					}
					else
						res.sendStatus(401)
				}
				else
					res.sendStatus(500)
			}
			else
				res.sendStatus(500)
		});*/

	}

})
 //web part
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
				var uid = new require('mongodb').ObjectID(token[0])
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
	if(!req.session.uid && req.body.email && req.body.password ) {
		//not logged in
		req.body.email = String(req.body.email);
		req.body.password = String(req.body.password);

		if(req.body.username) {
			if(req.body.username.length > 2 && req.body.username.length <= 25)
				req.body.username = String(req.body.username);
			else
				delete req.body.username;
		}

		if( /\S+@\S+\.\S+/.test(req.body.email)&& req.body.password.length >= 8 && req.body.password.length <= 75 ){
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
						var insert = {
							'password': false,
							'email': mongo_sanitize(req.body.email),
							'verified': results[0],
							'signupDate': Date.now(),
							'salt': results[1]
						}
						if(req.body.username)
							insert.username=mongo_sanitize(req.body.username)

						users.insert(insert, function(err, resultInsert) {
							if(resultInsert.insertedCount == 1 && err == null) {
								//successfully inserted, begin hash calculation
								hashPass(req.body.password, results[1], function(hash) {
									if (err) throw err;
									users.updateOne({ _id : resultInsert.insertedIds[0] }, { $set: { 'password' : hash.toString('hex') } }, function(err, resultPass) {
										if(resultPass.modifiedCount == 1) {
											// send mail with defined transport object
											//TODO ttl, delete after no answer -> index
											options.mailValidation(results[0], resultInsert.ops[0].email, function(err, info) {
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
				var criteria={ 'username' : mongo_sanitize(String(req.body.username)) }
			else if(req.body.email)
				var criteria={ 'email' : mongo_sanitize(String(req.body.email)) }
			users.find(criteria).toArray(function(err, docs) {
				if(docs.length == 1) {
					if(docs[0].verified !== true) {
						users.updateOne(criteria, { $set: { 'verified' : token } }, function(err, result) {
							if(result.modifiedCount == 1) {
								// send mail
								options.mailValidation(token, docs[0].email, function(err, info) {
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
			var criteria={ 'email' : mongo_sanitize(String(req.body.email)) }
			users.find(criteria).toArray(function(err, docs) {
				if(docs.length == 1) {
					if(docs[0].verified == true) {
						//TODO TTL
						users.updateOne(criteria, { $set: { 'changePasswordToken' : token } }, function(err, result) {
							if(result.modifiedCount == 1) {
								// send mail //TODO customize mail for pass update
								options.mailValidation(token, docs[0].email, function(err, info) {
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
.use('/uploads', require('express').static(__dirname + '/uploads'));

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
	var aggregate = [
		{ $match: find },
		{ $project : {
			reviews: { $slice: [ '$reviews', 10 ] } ,
			name: 1,
			brewery_id: 1,
			abv: 1,
			ibu: 1,
			categories: 1,
			wikidata_id: 1,
			images: {
				$filter: {
					input: '$images',
					as: 'image',
					cond: {$gt: ['$$image.maxSize', null]}
				}
			}
		}}
	];
	console.log(aggregate)
	var cursor = beers.aggregate(aggregate)
		//images: { $: { maxSize: { $ne : null } } } } ).limit(10);

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
		console.log(criteria)
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
			res.sendStatus(401)
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
function getPutImageUrl(imageId) {
	return options.url+'/uploadImage/'+imageId;
}
function getImageId(objectId, cb) {
	crypto.randomBytes(4, (err, buf) => {
		if (err) cb(false);
		else {
			cb(objectId+buf.toString('hex'));
		}
	});
}
function pushImage(beerId, imageId, uid, cb, maxSize) {
	var obj = sanitizer.insertDateAndUser(imageId, true, uid)
	if(maxSize)
		obj.maxSize=maxSize;
	beers.updateOne(
		{ _id : mongo_uuid(beerId) },
		{
			$push: {
				"images": {
					$each: [ obj ],
					$position: 0
				}
			}
		}, cb);
}
function insertImage(beerId, req, res, maxSize) {
//beer exists & is modified
	if(req.body.image!==true)
		res.sendStatus(200);
	else {
		getImageId(beerId, (imageId) => {
			pushImage(beerId, imageId, req.session.uid, function(err, result) {
				console.log(err)
				console.log(beerId)
				console.log(sanitizer.insertDateAndUser(imageId, true, req.session.uid))
				if(err === null) {
					if(result.matchedCount >= 1)
						res.status(200).send(getPutImageUrl(imageId));
					else
						res.sendStatus(401)
				}
				else
					res.sendStatus(500)
			});
		});
	}
}
function resize(image, objectId, callback) {
	gm(image).size(function(err, value){
		var i=true
		var imageName = objectId + '.jpg';
		var maxSize;
		function cb (err) {
			if(i) {
				if(err)
					callback(err, maxSize)
				else
					callback(false, maxSize)

				//console.log('Created an image from a Buffer!');
				i=false;
			}
		}
		function setSize(size) {
			console.log(size)
			if(!maxSize)
				maxSize=size;
		}
		if(value.width >= 1080) {
			setSize(1080)
			gm(image, imageName).resize(1080).write(__dirname + '/uploads/1080/' + imageName, cb);
		}
		if(value.width >= 720) {
			setSize(720)
			gm(image, imageName).resize(720).write(__dirname + '/uploads/720/' + imageName, cb)
		}
		if(value.width >= 480) {
			setSize(480)
			gm(image, imageName).resize(480).write(__dirname + '/uploads/480/' + imageName, cb)
		}
		if(value.width >= 360) {
			setSize(360)
			gm(image, imageName).resize(360).write(__dirname + '/uploads/360/' + imageName, cb)
		}
		setSize(144)
		gm(image, imageName).resize(144).write(__dirname + '/uploads/144/' + imageName, cb)
		//TODO
	})

}

function checkDirectorySync(directory) {
	try {
		fs.statSync(directory);
	} catch(e) {
		fs.mkdirSync(directory);
	}
}

