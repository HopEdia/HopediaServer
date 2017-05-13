const assert = require('assert');
const mongo_uuid = require('mongodb').ObjectID;

exports = module.exports;

var beers;
var self = {};


module.exports = Model;


function Model(collection) {
	beers=collection;
	return module.exports;
}


Model.findBeer = function(properties, cb) {
	var json = []
	var find = {}
	Object.keys(properties).forEach(function (value, index, array) {
		switch (value) {
			case 'id':
				find['_id']=mongo_uuid(properties[value]);
				break;
			case 'name':
				//find.$text= {$search: properties[value]}
				//break;
			case 'name_completion':
				find['name._value']= {$regex: '(?:^| )'+properties[value]+'.*', $options: 'ig'}
				break;
			case 'brewery_id':
			case 'abv':
			case 'cat_id':
				find[value]=properties[value]
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
	console.log(properties)
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
/**
 * This callback is displayed as part of the Requester class.
 * @callback Model~findBeerCallback
 * @param {Object} beers Either the list of beers found or false if nothing was found
 */
Model.edit = function(res) {
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
