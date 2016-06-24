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
      sanitizer = require('hopedia_beer_sanitizer')

var util=require('util')

exports = module.exports = main;

var db;
var beers,
    secret;

const acceptGetProp = ['id', 'name', 'brewery_id', 'abv', 'cat_id', 'ingredients', 'name_completion', 'barcode', 'barcode_format'];
const type = ['bottle', 'can', 'draft'];

function main(options) {
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

beers = db.collection('beers');

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
});

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

