const Graph = require('../models/graph_model');
const { neo4j, driver } = require('../config/neo4j');

const updateGraphEdge = async (txc, gid, debtMain, debtDetail) => {
    console.debug('gid, debtDetail, debtMain', gid, debtDetail, debtMain);
    try {
        let map = [];
        let debtDetailExcluded = [];
        debtDetail.forEach((debt) => {
            console.debug(debt);
            if (debt.borrower != debtMain.lender && debt.amount != 0) {
                map.push({ name: neo4j.int(debt.borrower), amount: neo4j.int(debt.amount) }); //處理neo4j integer
                debtDetailExcluded.push({ borrower: debt.borrower, amount: debt.amount });
            }
        });
        console.debug('map, debtDetailExcluded: ', map, debtDetailExcluded);
        //上面會需要debtDetail和map兩個的原因是因為一個是要丟進去neo的需要先做數字處理，另一個是拿來比對的不要有數字處理

        //先查出原本的債務線
        const getEdgeResult = await Graph.getCurrEdge(txc, neo4j.int(gid), neo4j.int(debtMain.lender), map);
        let newMap = [];
        getEdgeResult.records.forEach((oldDebt, ind) => {
            console.log('oldDebt: ', oldDebt);
            let start = oldDebt.get('start').toNumber();
            let end = oldDebt.get('end').toNumber();
            let originalDebt = oldDebt.get('amount').toNumber();
            console.log('current:', start, end, originalDebt);

            if (start == debtDetailExcluded[ind].borrower) {
                // 原本債務關係和目前一樣 borrower-own->lender
                let newBalance = originalDebt + debtDetailExcluded[ind].amount;
                if (newBalance > 0) {
                    // 維持borrower <-own-lender
                    console.debug('balance1: ++', 'borrower', neo4j.int(start), 'lender', neo4j.int(end), neo4j.int(newBalance));
                    newMap.push({ borrower: neo4j.int(start), lender: neo4j.int(end), amount: neo4j.int(newBalance) });
                } else if (newBalance < 0) {
                    // 改為borrower-own->lender //如果是update debt，會把舊的帳的值先變成負的，再呼叫這個function做計算，所以確實有可能是負的
                    newBalance = -newBalance;
                    console.debug('balance2: +-', 'borrower', neo4j.int(end), 'lender', neo4j.int(start), neo4j.int(newBalance));
                    newMap.push({ borrower: neo4j.int(end), lender: neo4j.int(start), amount: neo4j.int(newBalance) });
                    Graph.deletePath(txc, neo4j.int(gid), neo4j.int(start), neo4j.int(end)); //因為neo不能直接改反向關係，所以刪除本來的線，下面直接新增
                } else if (newBalance === 0) {
                    console.debug('balance: +=');
                    Graph.deletePath(txc, neo4j.int(gid), neo4j.int(start), neo4j.int(end)); //等於0的時候把線刪除
                }
            } else if (end == debtDetailExcluded[ind].borrower) {
                // 原本債務關係和目前相反 borrower<-own-lender
                let newBalance = originalDebt - debtDetailExcluded[ind].amount;
                if (newBalance > 0) {
                    // 維持borrower <-own-lender
                    console.debug('balance3: --', 'borrower', neo4j.int(start), 'lender', neo4j.int(end), neo4j.int(newBalance));
                    newMap.push({ borrower: neo4j.int(start), lender: neo4j.int(end), amount: neo4j.int(newBalance) });
                } else if (newBalance < 0) {
                    // 改為borrower-own->lender
                    newBalance = -newBalance;
                    console.debug('balance4: -+', 'borrower', neo4j.int(end), 'lender', neo4j.int(start), neo4j.int(newBalance));
                    newMap.push({ borrower: neo4j.int(end), lender: neo4j.int(start), amount: neo4j.int(newBalance) });
                    Graph.deletePath(txc, neo4j.int(gid), neo4j.int(start), neo4j.int(end)); //因為neo不能直接改反向關係，所以刪除本來的線，下面直接新增
                } else if (newBalance === 0) {
                    console.debug('balance: -=');
                    Graph.deletePath(txc, neo4j.int(gid), neo4j.int(start), neo4j.int(end)); //等於0的時候把線刪除
                }
            } else {
                //找不到, 新增一筆
                let debt = debtDetailExcluded[ind].amount;
                if (debt > 0) {
                    console.debug('balance5: x+', 'borrower', neo4j.int(debtDetailExcluded[ind].borrower), 'lender', neo4j.int(debtMain.lender), neo4j.int(debt));
                    newMap.push({ borrower: neo4j.int(debtDetailExcluded[ind].borrower), lender: neo4j.int(debtMain.lender), amount: neo4j.int(debt) });
                } else {
                    console.debug('balance5: x-', 'borrower', neo4j.int(debtMain.lender), 'lender', neo4j.int(debtDetailExcluded[ind].borrower), neo4j.int(-debt));
                    newMap.push({ borrower: neo4j.int(debtMain.lender), lender: neo4j.int(debtDetailExcluded[ind].borrower), amount: neo4j.int(-debt) });
                }
            }
        });
        //更新線
        console.log('for Neo newMap:   ', newMap);
        const updateGraphEdgeesult = await Graph.updateEdge(txc, neo4j.int(gid), newMap);
        console.log('updateGraphEdgeesult: ', updateGraphEdgeesult.records);
        if (!updateGraphEdgeesult) {
            console.error(updateGraphEdgeesult);
            throw new Error('Internal Server Error');
        }
        return updateGraphEdgeesult;
    } catch (err) {
        console.log(err);
        return false;
    }
};
const getBestPath = async (txc, gid) => {
    try {
        const graph = {};
        const allNodeList = [];
        const pathsStructure = {};
        const order = [];
        // console.log('search group:', group);

        // 1) Neo4j get all path
        try {
            // 1-1) 查詢圖中所有node
            console.log('TO Neo allNode:  ', neo4j.int(gid));
            const allNodesResult = await Graph.allNodes(txc, neo4j.int(gid));
            allNodesResult.records.forEach((element) => {
                let name = element.get('name').toNumber();
                graph[name] = {};
                allNodeList.push(name);
            });
            // console.log('allNodeList: ', allNodeList);

            // 1-2) 查每個source出去的edge數量
            for (let source of allNodeList) {
                console.log('To Neo sourceEdge:  ', neo4j.int(gid), neo4j.int(source));
                const sourceEdgeResult = await Graph.sourceEdge(txc, neo4j.int(gid), neo4j.int(source));
                pathsStructure[source] = { sinksSummary: { sinks: [], qty: 0 }, sinks: {} };
                pathsStructure[source].sinksSummary.qty = sourceEdgeResult.records.length; //紀錄qty
                sourceEdgeResult.records.forEach((element, index) => {
                    pathsStructure[source].sinksSummary.sinks.push(element.get('name').toNumber());
                });
                order.push({ source, qty: pathsStructure[source].sinksSummary.qty }); //同步放進order的列表中
            }
            order.sort((a, b) => {
                return b.qty - a.qty; //排序列表供後面決定順序用
            });
        } catch (err) {
            console.error('ERROR AT getBestPath Neo4j Search: ', err);
            return false;
        }
        // console.log('order:', order);

        //第一層：iterate sources
        for (let source of order) {
            // console.log('source: ', source.source);
            let currentSource = source.source; //當前的source
            // 1-3) 查所有的路徑
            console.log('To Neo allPath:  ', neo4j.int(gid), neo4j.int(currentSource));
            const pathsResult = await Graph.allPaths(txc, neo4j.int(gid), neo4j.int(currentSource));
            // console.log(pathsResult);
            //第二層：iterate paths in source
            for (let i = 0; i < pathsResult.records.length; i++) {
                const sink = pathsResult.records[i]._fields[0].end.properties.name.toNumber(); //當前path的sink
                // console.log('sink', sink);
                if (!pathsStructure[currentSource].sinksSummary.sinks.includes(sink)) {
                    //代表和這個人沒有直接的借貸關係
                    continue;
                }
                //第三層：iterate edges in path
                let edges = []; //組成path的碎片陣列
                pathsResult.records[i]._fields[0].segments.forEach((edge) => {
                    console.debug(
                        'From neo edge:  ',
                        'start:',
                        edge.start.properties.name.toNumber(),
                        'r: ',
                        edge.relationship.properties.amount.toNumber(),
                        'end:',
                        edge.end.properties.name.toNumber()
                    );
                    //更新欠款圖graph的debt
                    graph[edge.start.properties.name.toNumber()][edge.end.properties.name.toNumber()] = edge.relationship.properties.amount.toNumber(); //TODO:不確定為什麼這邊不需要.toNumber
                    // graph[edge.start.properties.name.toNumber()][edge.end.properties.name.toNumber()] = edge.relationship.properties.amount;
                    //將碎片放進陣列中
                    edges.push([edge.start.properties.name.toNumber(), edge.end.properties.name.toNumber()]);
                    // console.log('放碎片：', edges);
                });
                //更新路徑表pathsStructure
                if (!pathsStructure[currentSource].sinks[sink]) {
                    pathsStructure[currentSource].sinks[sink] = [];
                }
                pathsStructure[currentSource].sinks[sink].push(edges);
                // console.log('完整碎片組', edges);
            }
        }
        // console.debug(pathsStructure);
        // console.debug('最終存好的graph: ', graph);

        // 3) calculate best path
        // 第一層：iterate sources by order
        const debtsForUpdate = []; //用來存所有被變動的路徑與值
        for (let source of order) {
            // console.log('目前souce: ', source.source);
            //第二層：iterate sinks in source
            // // console.log('所有sinks:', pathsStructure[source.source].sinks);
            Object.keys(pathsStructure[source.source].sinks).forEach((sink) => {
                // console.log('目前sink:', sink);
                let totalFlow = 0; //用來存當圈要加到最短sounce-sink的流量
                //第三層：iterate paths of source->sink
                for (let path of pathsStructure[source.source].sinks[sink]) {
                    // console.debug('目前path', path);
                    let bottleneckValue = 0;
                    let pathBlock = false;
                    if (path.length != 1) {
                        //如果等於1代表示source直接到sink的path
                        //第四層：iterate edges in path
                        // console.log('扣除前：', graph);
                        let debts = [];

                        // 3-1) 找出路徑上每個edge的debt
                        for (let edge of path) {
                            if (!graph[edge[0]][edge[1]]) {
                                pathBlock = true;
                                break; //當兩點容量已為0或不存在則break
                            }
                            debts.push(graph[edge[0]][edge[1]]);
                        }
                        if (pathBlock) {
                            continue;
                        }

                        // 3-2) 算優化
                        //找出瓶頸edge流量
                        // console.log('debts', debts);
                        bottleneckValue = Math.min.apply(Math, debts);
                        // console.log('扣除量:', bottleneckValue);
                        //將所有edge都減去瓶頸流量
                        path.forEach((edge) => {
                            graph[edge[0]][edge[1]] -= bottleneckValue;
                            // debtsForUpdate.push({ borrowerId: edge[0], lenderId: edge[1], adjust: -bottleneckValue });
                            debtsForUpdate.push({ borrower: neo4j.int(edge[0]), lender: neo4j.int(edge[1]), amount: neo4j.int(-bottleneckValue) });
                        });
                        // 3-3) 將流量先暫加到totalFlow
                        totalFlow += bottleneckValue;
                        // console.log('累積ttlflow:', totalFlow);
                        // console.log('扣除後：', graph);
                    }
                }
                // 3-4) 將totalFlow加到最短的邊上
                // console.debug('totalFlow', totalFlow);
                if (totalFlow) {
                    // console.log('總ttlflow:', totalFlow);
                    graph[source.source][sink] += totalFlow;
                    // console.log('TO Neo debtsfor update:  ', 'borrower', neo4j.int(source.source), 'lender', neo4j.int(sink), 'amount', neo4j.int(graph[source.source][sink]));
                    // debtsForUpdate.push({ borrowerId: neo4j.int(source.source), lenderId: neo4j.int(sink), amount: neo4j.int(graph[source.source][sink]) });
                    // console.log('TO Neo debtsfor update:  ', 'borrower', neo4j.int(source.source), 'lender', neo4j.int(sink), 'amount', neo4j.int(totalFlow));
                    debtsForUpdate.push({ borrower: neo4j.int(source.source), lender: neo4j.int(sink), amount: neo4j.int(totalFlow) });
                    // console.log('加流量：', graph);
                }
            });
        }
        console.info('handler: best path graph debtsForUpdate:', graph, debtsForUpdate);
        return [graph, debtsForUpdate];
    } catch (err) {
        console.error('ERROR AT getBestPath: ', err);
        return false;
    }
};

module.exports = { updateGraphEdge, getBestPath };
