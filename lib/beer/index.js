const assert = require('assert'),
      bodyParser = require('body-parser'),
      mongo_uuid = require('mongodb').ObjectID,
      sanitizer = require('hopedia_beer_sanitizer'),
      crypto = require('crypto');

//const types = ['bottle', 'can', 'draft'];

exports = module.exports = main;

var beers;

let controller;


function main(app, beersC, options) {
	beers=beersC;
	controller = require('./controller.js')(beers);
	beers.createIndex({"name._value": "text"})
	//for regex use
	beers.createIndex({"name._value": 1}, { unique: true })

	beers.createIndex({"brewery_id._value": 1})
	beers.createIndex({"abv._value": 1})
	beers.createIndex({"cat_id._value": 1})
	/**
	 * @apiDefine user User
	 * Account is activated and user is logged-in
	 */
	app
	/**
	 * @apiDefine BeerObj
	 * @apiName BeerObj
	 * @apiGroup Beer
	 * @apiVersion 0.1.0
	 *
	 * @apiParam {String} [id] Beer ID.
	 * @apiParam {String} [name] Beer name.
	 * @apiParam {String} [name_completion] Beer name, to use with auto completion.
	 * @apiParam {String} [brewery_id] The id of the brewery brewing that beer.
	 * @apiParam {Number} [abv] The Alcohol by volume of the beer, SI units.
	 * @apiParam {String} [cat_id] Category ID, not yet implemented.
	 * @apiParam {String[]} [barcode] Barcode.
	 * @apiParam {String} [barcode._value] Value of the barcode.
	 * @apiParam {String='AZTEC','CODABAR','CODE_39','CODE_93','CODE_128','DATA_MATRIX','EAN_8','EAN_13','ITF','MAXICODE','PDF_417','QR_CODE','RSS_14','RSS_EXPANDED','UPC_A','UPC_E','UPC_EAN_EXTENSION'} [barcode.format]
	 Format of the barcode, as returned by ZXing.
	 */
	 /**
	 * @apiUse BeerObj
	 * @apiGroup Beer
	 * @apiVersion 0.1.0
	 * @api {get} /beer Get a list of beers
	 */
	.get('/beer', function(req, res) {
		req.body = req.query
		controller.handleBeer(req, res)
	})
	/**
	 * @apiUse BeerObj
	 * @apiGroup Beer
	 * @apiVersion 0.1.0
	 * @api {post} /beerJSON Get a list of beers
	 * @apiContentType application/json
	 */
	.post('/beerJSON', bodyParser.json(), controller.handleBeer)
	/**
	 * @apiGroup Beer
	 * @apiVersion 0.1.0
	 * @apiParam {String} id Beer ID.
	 * @apiParam {String} [shop] Shop ID
	 * @apiParam {Number} [ebc] EBC, European Brewery Convention beer color.
	 * @apiParam {String=bottle, can, draft} [packaging] Packaging, not yet implemented
	 * @apiParam {String} [packaging] Packaging, not yet implemented
	 * @apiParam {Number[]} scent
	 * 	@apiParam {Number{0-100}} scent.sweet
	 * 	@apiParam {Number{0-100}} scent.bitter
	 * 	@apiParam {Number{0-100}} scent.acid
	 * 	@apiParam {Number{0-100}} scent.alcohol
	 * 	@apiParam {Number{0-100}} scent.fruit
	 * 	@apiParam {Number{0-100}} scent.other
	 * @apiParam {Number[]} taste
	 * 	@apiParam {Number{0-100}} taste.sweet
	 * 	@apiParam {Number{0-100}} taste.bitter
	 * 	@apiParam {Number{0-100}} taste.acid
	 * 	@apiParam {Number{0-100}} taste.alcohol
	 * 	@apiParam {Number{0-100}} taste.fruit
	 * 	@apiParam {Number{0-100}} taste.other
	 * @apiParam {String[]} remark
	 * @apiParam {String{2}} remark.lang The language in which the remark is written.
	 * @apiParam {String{1..300}} remark._value A comment about the beer
	 * @apiParam {Number{1-10}} rate The rate attributed to the beer
	 *
	 * @api {post} /reviewBeer Add a review to a beer
	 * @apiPermission user
	 * @apiContentType application/json
	 */
	.post('/reviewBeer', bodyParser.json(), controller.review)
	/**
	 * @apiUse BeerObj
	 * @apiGroup Beer
	 * @apiParam {String} id Beer ID
	 * @apiVersion 0.1.0
	 * @api {post} /editBeer Edit a beer
	 * @apiPermission user
	 * @apiContentType application/json
	 */
	.post('/editBeer', bodyParser.json(), controller.edit)
	/**
	 * @apiUse BeerObj
	 * @apiGroup Beer
	 * @apiParam {String} [id] Will be generated automatically, not needed at all
	 * @apiVersion 0.1.0
	 * @api {post} /insertBeer Insert a beer
	 * @apiPermission user
	 * @apiContentType application/json
	 */
	.post('/insertBeer', bodyParser.json(), controller.insert)
	/**
	 * @apiGroup Beer
	 * @apiVersion 0.1.0
	 * @api {put} /uploadImage/:objectId Upload an image to the server
	 * @apiParam {Number} objectId Id of the object to be sent
	 * @apiPermission user
	 * @apiContentType application/json
	 */
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

