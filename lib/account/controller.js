const acceptGetProp = ['id', 'name', 'brewery_id', 'abv', 'cat_id', 'ingredients', 'name_completion', 'barcode', 'barcode_format'];
const mongo_sanitize = require('mongo-sanitize'),
      mongo_uuid = require('mongodb').ObjectID,
      crypto = require('crypto'),
      async = require('async');

exports = module.exports;

var self = {};
var model;
var options;
var users;
module.exports = function(collection, param) {
	//beers=collection;
	/*model=require('./model.js');
	model=new model(collection);*/
	users=collection;
	options=param;
	return self;
}


self.get_token = function (req, res) {
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
		//TODO, just return?
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
}

self.login = function(req, res) {
	req.body.token = String(req.body.token);
	console.log(req.body.token);
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
				res.status(401).send('token_expired');
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
}

self.signup = function(req, res) {
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
								console.log(err.errmsg);
								res.status(422).send(/index: .*users\.\$(.*)_\d.*/.exec(err.errmsg)[1]);
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
}

self.resend_mail_token = function(req, res) {
	//TODO check password, could be annoying if someone was spamming this endpoint with your email before you could sign-up
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
}

self.change_password = function(req, res) {
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
						res.status(422).send('account_not_active');
				}
				else
					res.status(401).send('account_not_found');

			});
		});
	}
	else {
		res.sendStatus(401);
	}
}

function sign(buf, cb) {
	var hmac = crypto.createHmac('sha256', options.secret);
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
								res.status(401).send('invalid_token')
							}

						},
						function(token) {
							//NOT valid
							res.sendStatus(401)
						}
					);
				}
				else if(hash === docs[0].password)
					res.status(401).send('account_not_active')
				else
					res.status(401).send("wrong_pass_or_email")
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
						res.status(401).send('invalid_token')
					}
				},
				function(token) {
					//NOT valid
					res.sendStatus(401)
				}
			);
		}

		else {
			res.sendStatus(401)
		}
	});
}

function sign(buf, cb) {
	var hmac = crypto.createHmac('sha256', options.secret);
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
	crypto.randomBytes(options.token_rand_byte, (err, buff) => {
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
