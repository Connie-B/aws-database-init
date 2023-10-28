const mysql = require('mysql')
const AWS = require('aws-sdk')
const fs = require('fs')
const path = require('path')

const secrets = new AWS.SecretsManager({})

exports.handler = async (e) => {
  try {
    const { config } = e.params
    const username = config.username
    const theSecretName = config.credsSecretName
    const password = await getSecretValue(theSecretName)
    const host = config.hostname
    const port = config.port

    // confirm we are able to resolve the RDS instance
    // const dns = require('dns')
    // const resolve = (cname) => {
    //   const getIp = (accum) =>
    //     dns.resolve(cname,
    //       callback=(err, result) => {
    //         if (err) {
    //           console.error(`error: ${err}`)
    //         } else {
    //           result.push.apply(result, accum)
    //           console.log(result)
    //         }
    //       })
    //   let accum = []
    //   const getCnames = (err, result) => {
    //     if (err) {
    //       // no more records
    //       getIp(accum)
    //     } else {
    //       const cname = result[0]
    //       accum.push(cname)
    //       dns.resolveCname(cname, getCnames)
    //     }
    //   }
    //   dns.resolveCname(cname, getCnames)
    // }
    // resolve(host)

    const connection = mysql.createConnection({
      user: username,
      password: password,
      host: host,
      port: port,
      multipleStatements: true
    })
    connection.connect()

    const sqlScript = fs.readFileSync(path.join(__dirname, 'script.sql')).toString()
    const res = await query(connection, sqlScript)
    connection.end()

    return {
      status: 'OK',
      results: res
    }
  } catch (err) {
    return {
      status: 'ERROR',
      err,
      message: err.message
    }
  }
}

function query (connection, sql) {
  return new Promise((resolve, reject) => {
    connection.query(sql, (error, res) => {    
      if (error) return reject(error)

      return resolve(res)
    })
  })
}

function getSecretValue (secretId) {
  return new Promise((resolve, reject) => {
    secrets.getSecretValue({ SecretId: secretId }, (err, data) => {
      // console.log(JSON.stringify(data))
      if (err) return reject(err)

      return resolve(data.SecretString)
    })
  })
}
