const mongo_sanitize = require('mongo-sanitize'),
      bodyParser = require('body-parser'),
      mongo_uuid = require('mongodb').ObjectID,
      crypto = require('crypto'),
      async = require('async');

exports = module.exports = main;

var users;
let controller;

function main(app, usersC, options) {
	users=usersC;
	controller = require('./controller.js')(beers);

	users.createIndex( { "email": 1 }, { unique: true } )
	users.createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $exists: true } } } )

	//search, if reviews exist modify
	users.createIndex( { "reviews.user": 1 } )

	//web part
	app
	/**
	 * @apiGroup Account
	 * @apiVersion 0.1.1
	 * @api {post} /getToken Get a long-lived token
	 * @apiDescription Get a token valid for a lunar revolution (27.3 days, 2358720000milliseconds)
	 *
	 * These tokens are base64-encoded string containing the uid, the date of emission, random bytes.
	 * Everything is signed with the server's key.
	 *
	 * @apiParam (email login) {String} email User's e-mail
	 * @apiParam (email login) {String} password User's password
	 * @apiParam (email login) {String} [validationToken] Token sent by mail if you are activating the account.
	 * @apiParam (username login) {String} username User's e-mail
	 * @apiParam (username login) {String} password User's password
	 * @apiParam (username login) {String} [validationToken] Token sent by mail if you are activating the account.
	 *
	 * @apiParam (email password recovery) {String} email User's e-mail
	 * @apiParam (email password recovery) {String} newPassword User's password to be set.
	 * @apiParam (email password recovery) {String} validationToken Token sent by mail.

	 * @apiParam (username password recovery) {String} username User's e-mail
	 * @apiParam (username password recovery) {String} newPassword User's password to be set.
	 * @apiParam (username password recovery) {String} validationToken Token sent by mail.
	 * @apiSuccess {String} token A long-lived token
	 * @apiSuccessExample {text} Success-Response:
	 *	HTTP/1.1 200 OK
	 *	rfgfzuwsdzfuse
	 * @apiContentType application/json
	 *
	 * @apiError (Error 401) {String} wrong_pass_or_email Password or e-mail is wrong
	 * @apiError (Error 401) {String} account_not_active The accoun't hasn't been activated, maybe you forgot validationToken?
	 * @apiError (Error 401) {String} invalid_token The validation token is either too old, or doesn't correspond to the account
	 */
	.post('/getToken', bodyParser.json(), controller.get_token)
	/**
	 * @apiGroup Account
	 * @apiVersion 0.1.1
	 * @api {post} /login Login
	 * @apiDescription Session will be stored in cookies.
	 *
	 * If the token has been emitted between one day and a lunar revolution (27.3 days),
	 * a new long-lived token will be emitted. You have to store the new one and remove the old one.
	 * @apiParam (token) {String} Token sent by getToken
	 * @apiSuccess {String} token A long-lived token, if the token has to be regenrated.
	  * @apiSuccessExample {text} Successful-Login:
	 *	HTTP/1.1 200 OK
	 *	rfgfzuwsdzfuse
	 * @apiSuccessExample {text} Successful-Login:
	 *	HTTP/1.1 200 OK
	 * @apiContentType application/json
	 *
	 * @apiError (Error 401) {String} token_expired The token is too old, you have to use getToken again.
	 * @apiError (Error 404) {String} NotFound The token hasn't been found.
	 * @apiError (Error 401) {String} invalid_token The token signature is invalid.
	 * @apiError (Error 400) {String} empty_token No token provided
	 */
	.post('/login', bodyParser.json(), controller.login)
	/**
	 * @apiGroup Account
	 * @apiVersion 0.1.1
	 * @api {post} /signup Sign-up
	 * @apiDescription Create a new account.
	 * @apiParam {String} email User's e-mail
	 * @apiParam {String} username username
	 * @apiParam {String} password User's password

	 * @apiContentType application/json
	 *
	 * @apiError (Error 422) {String} username Username already used.
	 * @apiError (Error 422) {String} email E-mail already used.
	 */
	.post('/signup', bodyParser.json(), controller.signup)
	/**
	 * @apiGroup Account
	 * @apiVersion 0.1.1
	 * @api {post} /resendMailToken Send the sign-up validation token one more time.
	 * @apiParam (email recovery) {String} email User's e-mail
	 * @apiParam (username recovery) {String} username username

	 * @apiContentType application/json
	 *
	 */
	.post('/resendMailToken', bodyParser.json(), controller.resend_mail_token)
	/**
	 * @apiGroup Account
	 * @apiVersion 0.1.1
	 * @api {post} /changePassword Change password
	 * @apiDescription Change your password, a confirmation link will be sent to your mailbox. Then you can change your password, see <a href="#api-Account-PostGettoken">getToken</a>
	 * @apiParam {String} email User's e-mail
	 * @apiContentType application/json
	 *
	 */
	.post('/changePassword', bodyParser.json(), controller.change_password)
}

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
