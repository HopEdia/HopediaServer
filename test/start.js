const mongo = require('mongodb').MongoClient,
      api = require('../index.js'),
      nodemailer = require('nodemailer'),
      util = require('util');

var url = 'mongodb://localhost:27017/test';
var server_port=8080
var server_ip_address='192.168.1.109'

var mailer = nodemailer.createTransport();

mongo.connect(url, function(err, database) {
	util.log("Connected correctly to server.");
	api({
		database: database,
		secret: '128-bit',
		port:server_port,
		hostname: server_ip_address,
		url: 'http://192.168.1.109:8080',
		mailValidation: function (token, email, cb) {
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
	});
});
