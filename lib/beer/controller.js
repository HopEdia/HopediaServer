const mongo_sanitize = require('mongo-sanitize');
const acceptGetProp = ['id', 'name', 'brewery_id', 'abv', 'cat_id', 'ingredients', 'name_completion', 'barcode', 'barcode_format'];
const mongo_uuid = require('mongodb').ObjectID;

exports = module.exports;

//var beers;
var self = {};
var model;

module.exports = function(collection) {
	//beers=collection;
	model=require('./model.js');
	model=new model(collection);
	console.log(model);
	return self;
}

self.handleBeer = function(req, res) {
	for(var i in req.body) {
		if (acceptGetProp.indexOf(i) < 0 || req.body[i]===''){
			delete req.body[i]
			continue;
		}
		if(req.body[i] == 'null') {req.body[i]=null}
		req.body[i]=mongo_sanitize(req.body[i])
	}
	if (Object.keys(req.body).length > 0) {
		var json = []
		model.findBeer(req.body, function(obj) {
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
self.review = function(req, res) {
	if(req.body.beerId && req.session.uid && req.body.review) {
		var review = {}

		review.shop = sanitizer.beer.shop(req.body.review.shop)
		review.ebc = sanitizer.beer.ebc(req.body.review.ebc)
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
}
self.edit = function(req, res){
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
			var key;
			for (key in beer) {
				// skip loop if the property is from prototype
				if (!beer.hasOwnProperty(key)) continue;
				update.$push[key] = {
					$each: [ beer[key] ],
					$position: 0
				}
			}
			model.edit(res);
		}
		else if(req.body.image === true) {
			console.log(req.body._id)
			insertImage(req.body._id, req, res)

		}
		//nothing sent (empty req or wrong values, check client side)
		else
			res.sendStatus(401)
	}
	else {
		res.sendStatus(401)
	}
}
self.insert = function(req, res){
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
				if(err === null)
					insertImage(result.insertedId, req, res)
				//TODO reinforce regex
				else
					res.status(400).send(/\$(.*)_\d.*/.exec(err.errmsg)[1])
			});
		}
		//nothing sent (empty req or wrong values, check client side)
		else
			res.sendStatus(401)
	} else {
		res.sendStatus(401)
	}
}
