const fs = require('fs');
let content = fs.readFileSync("./routes/api.js", "utf8");
let sql_queries = content.match(/`((select|SELECT|update|UPDATE|insert|INSERT|delete|DELETE)([^`]+)`)/g);
let replaces = [];
//let test = sql_queries[35].match(/'\${[^']+}'/g);
//let test = sql_queries[63].match(/[^']\${[^}]+}[^']/g);
//console.log(test);
for (let sql of sql_queries) { 
	const strings = sql.match(/'\${[^}]+}'/g) || [];
	const numbers = (sql.match(/[^'%]\${[^}]+}[^'%]/g) || []).map(m => m.substring(1, m.length - 1));
	const strings_like = sql.match(/'%\${[^}]+}%'/g) || [];
	let replaced_sql = sql;
	let values = [];
	let reused = false
	const handle_pattern = (pattern, var_name) => { 
		const var_index = values.indexOf(var_name)
		if (var_index !== -1) {
			//console.log("reuse", var_name);
			reused = true;
			replaced_sql = replaced_sql.replace(pattern, `$${var_index + 1}`);
		} else { 
			//console.log("add", var_name);
			values.push(var_name);
			replaced_sql = replaced_sql.replace(pattern, `$${values.length}`);
		}
	}
	for (let pattern of strings) { 
		const var_name_raw = pattern.match(/^'\${([^}]+)}'$/)[1];
		const var_name = var_name_raw;
		//console.log(pattern, var_name);
		handle_pattern(pattern, var_name);

	}
	for (let pattern of numbers) { 
		const var_name_raw = pattern.match(/^\${([^}]+)}$/)[1];
		const var_name = `parseFloat(${var_name_raw})`;
		//console.log(pattern, var_name);
		handle_pattern(pattern, var_name);
	}
	for (let pattern of strings_like) { 
		const var_name_raw = pattern.match(/^'%\${([^}]+)}%'$/)[1];
		const var_name = `"%" + (${var_name_raw}) + "%"`;
		//console.log(pattern, var_name);
		handle_pattern(pattern, var_name);
	}
	if (!values.length) { 
		continue;
	}
	const replaced_pattern = `{text: ${replaced_sql}, values: [${values.join(", ")}]}`
	//console.log(sql, replaced_pattern);
	replaces.push({
		sql,
		replaced_pattern
	});
}
for (let rep of replaces) { 
	content = content.replace(rep.sql, rep.replaced_pattern);
}
fs.writeFileSync("tools/api.js", content);
