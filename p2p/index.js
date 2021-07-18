const EventEmitter = require('events').EventEmitter
const net = require('net')

const socketUtils = require('../utils/socket')
const bUtils = require('../chainUtils/blockchain')

const publicIp = require('public-ip')

module.exports = {
  serveP2P
}

function serveP2P (kafium, options) {
  const p2p = new EventEmitter()
  const knownPeers = new Set()

  if (options.P2P) {
    const p2pSetup = new net.Socket()

    p2pSetup.connect(options.P2P.split(':')[1], options.P2P.split(':')[0], function () {
      publicIp.v4().then(publicIp => {
        p2pSetup.write(`newPeer/${options.peerName}|${options.debug ? '127.0.0.1' : publicIp}:${options.port}&&`)
      })

      p2pSetup.on('data', function (data) {
        const packet = data.toString().split('&&')
        packet.forEach(data => {
          if (!data) return
          if (data.toString().startsWith('newPeer')) {
            if (knownPeers.has(data.replace('newPeer/', ''))) return
            knownPeers.broadcast(`${data}&&`)
            knownPeers.add(data.replace('newPeer/', ''))
            p2p.emit('newPeer', data.replace('newPeer/', ''))
          }
        })
      })
    })
  }

  const server = new net.Server()

  server.on('listening', function () {
    p2p.emit('ready')
  })

  server.on('error', function (err) {
    p2p.emit('error', err)
    p2p.emit('end')
  })

  server.on('close', function () {
    p2p.emit('end')
  })

  server.on('connection', function (socket) {
    socket.on('data', function (data) {
      const packet = data.toString().split('&&')
      packet.forEach(data => {
        if (!data) return
        if (data.startsWith('declareMe/')) {
          socket.peerData = `${data.split('/')[1].split('|')[0]}|${data.split('/')[1].split('|')[1]}`
        }

        if (data.startsWith('newPeer/')) {
          if (knownPeers.has(data.replace('newPeer/', ''))) return
          const args = data.split('/')[1].split('|')
          if (!args) return socket.write('Error/NeedAPeerName&&')
          socket.write(`newPeer/${options.peerName}|${options.debug ? '127.0.0.1' : publicIp}:${options.port}&&`)
          for (const peer of knownPeers) {
            socket.write(`newPeer/${peer}&&`)
          }
          knownPeers.broadcast(data)
          knownPeers.add(data.replace('newPeer/', ''))
          p2p.emit('newPeer', data.replace('newPeer/', ''))
        }

        if (data.startsWith('updatedBlockchainSize/')) {
          if(parseInt(data.split('/')[1]) > kafium.chain.length) {
            const p2pRequest = new net.Socket()
            p2pRequest.connect(socket.peerData.split('|').split(':')[1], socket.peerData.split('|').split(':')[0], function () {
              p2pRequest.write(`requestBlock/${data.split('/')[1]}`)
              socketUtils.waitForData(p2pRequest, 'requestedBlock').then(data => {
                const block = new bUtils.Block('', '', '', '')
                block.importFromJSON(JSON.parse(data.split('/')[1].replace('&&', '')))
                kafium.addBlock(block)
              })
            })
          }
        }

        if (data.startsWith('requestBlock/')) {
          socket.write(`requestedBlock/${kafium.chain[data.split('/')[1]].toData()}&&`)
        }
      })
    })
  })

  kafium.on('newBlock', function(block) {
    knownPeers.broadcast(`updatedBlockchainSize/${kafium.chain.length}&&`)
  })

  knownPeers.broadcast = function (data) {
    this.forEach(function(peer) {
      const p2pIpAddress = peer.split('|')[1]
      const p2pClient = new net.Socket()
      p2pClient.connect(p2pIpAddress.split(':')[1], p2pIpAddress.split(':')[0], function () {
        p2pClient.write(`declareMe/${options.peerName}|${options.debug ? '127.0.0.1' : publicIp}:${options.port}&&`, (err) => {
          p2pClient.write(`${data}&&`, (err) => {
            if (err) throw err
            p2pClient.end()
          })
        })
      })
    })
  }
  
  p2p.end = function () {
    server.close()
    server.removeAllListeners()
  }

  p2p.knownPeers = knownPeers

  server.listen(options.port)
  return p2p
}
