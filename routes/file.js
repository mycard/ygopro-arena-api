var formidable = require('formidable');
var fs = require('fs');  //node.js核心的文件处理模块

exports.upload = function (req, res, next) {
    var message = '';
    var form = new formidable.IncomingForm();  
    form.encoding = 'utf-8';       
    form.uploadDir = 'upload/';    
    form.keepExtensions = true;     
    form.maxFieldsSize = 2 * 1024 * 1024;  

    form.parse(req, function (err, fields, files) {
        if (err) {
            console.log(err);
            return res.status(500).send('upload image fail!')
        }

        var response = {};
        if (err) {
            response.code = 500;
        } else {
            response.code = 200;
            response.path = files.file.path;
        }
        
        res.json(response);
    });
};

exports.download = function (req, res) {
    
    var filename = req.params.id
    var filepath = 'upload/' + filename

    // filename:设置下载时文件的文件名，可不填，则为原名称
    res.download(filepath, filename);
};