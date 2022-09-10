const Debt = require('../models/debt_model');
const Graph = require('../models/graph_model');
const pool = require('../config/mysql');
const { neo4j, driver } = require('../config/neo4j');
const pageSize = 25;

const getDebtMain = async (req, res) => {
    const group = Number(req.query.group);
    const uid = Number(req.query.uid);
    const paging = Number(req.query.paging) || 0;
    const debtMainRecords = [];
    //撈所有該群組內的帳
    try {
        const [debtMainResult] = await Debt.getDebtMain(group, pageSize, paging);
        console.log('debtMain:', debtMainResult);
        //查借貸明細
        for (let debtMain of debtMainResult) {
            let debtMainId = debtMain.id;
            let ownAmount;
            let isOwned = false;
            const [debtDetailResult] = await Debt.getDebtDetail(debtMainId, uid);
            console.log('debtDetail:', debtDetailResult);

            //自己沒有參與這筆帳
            if (!debtDetailResult) {
                ownAmount = 0;
            }
            //自己是付錢的人
            if (uid === debtMain.lender) {
                isOwned = true;
                ownAmount = debtMain.total - debtDetailResult.amount;
            }
            const debtMainRecord = {
                id: debtMain.id,
                date: debtMain.debt_date,
                title: debtMain.title,
                total: debtMain.total,
                isOwned,
                lender: debtMain.lender,
                ownAmount: debtDetailResult.amount,
            };
            debtMainRecords.push(debtMainRecord);
        }
        res.status(200).json({ data: debtMainRecords });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ err });
    }
};

const postDebt = async (req, res) => {
    const debtMain = req.body.debt_main; //{gid, debt_date, title, total, lender, split_method}
    const debtDetail = req.body.debt_detail; //{ [ { borrower, amount} ] }
    const data = {};

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
        //1) MYSQL 新增raw data
        const debtMainId = await Debt.createDebtMain(conn, debtMain);
        data.debtId = debtMainId;
        if (!debtMainId) {
            throw new Error('Internal Server Error');
        }
        const debtDetailResult = await Debt.createDebtDetail(conn, debtMainId, debtDetail);
        if (!debtDetailResult) {
            throw new Error('Internal Server Error');
        }

        //2-1) MYSQL balance table 加入新的帳
        const updateBalanceResult = await updateBalance(conn, debtMain, debtDetail);
        if (!updateBalanceResult) {
            throw new Error('Internal Server Error');
        }
        console.log('DB到這裡都完成了');

        //2-2) NEO4j best path graph加入新的帳
        const session = driver.session();
        const updateGraphEdgeesult = await updateGraphEdge(session, debtMain, debtDetail);
        if (!updateGraphEdgeesult) {
            throw new Error('Internal Server Error');
        }
        console.log('Neo4j更新線的結果：', updateGraphEdgeesult);

        //全部成功，MySQL做commit
        await conn.commit();
        await conn.release();
        //TODO:處理沒有MATCH的狀況（不會跳error）

        //3)NEO4j取出所有路徑，並計算出最佳解
        const [graph, debtsForUpdate] = await getBestPath(session, debtMain.gid);
        if (!debtsForUpdate) {
            throw new Error('Internal Server Error');
        }
        data.graph = graph;
        //NEO4j更新best path graph
        const updateGraph = Graph.updateBestPath(debtsForUpdate);
        if (!updateGraph) {
            throw new Error('Internal Server Error');
        }
        res.status(200).json(data);
    } catch (err) {
        console.log('error: ', err);
        await conn.rollback();
        await conn.release();
        return res.status(500).json({ err });
    }
};

const getDebtDetail = async (req, res) => {
    try {
        const debtMainId = req.params.id;
        const result = await Debt.getDebtDetail(debtMainId);
        res.status(200).json({ data: result });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ err });
    }
};
const getMeberBalances = async (req, res) => {
    try {
        const gid = req.params.id;
        const result = await Debt.getAllBalances(gid);
        return res.status(200).json({ data: result });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ err });
    }
};
const getSettle = async (req, res) => {
    const groupId = req.params.id;
    const result = await Graph.getGraph(groupId);
    if (result.records.length !== 0) {
    }
    const graph = result.records.map((record) => {
        let amount = record.get('amount').toNumber();
        let borrower = record.get('borrower').toNumber();
        let lender = record.get('lender').toNumber();
        return { borrower, lender, amount };
    });
    res.status(200).json({ data: graph });
};
const postSettle = async (req, res) => {
    if ((req.query.user1, req.query.user2)) {
        //FIXME: 群組內兩兩結帳的狀況 不知道要怎麼算@@
        await Debt.deleteGroupPairDebts(conn, gid, uid1, uid2);
        await Debt.getBalance;
        await Graph.deleteBestPath(txc, req.params.id);
        await Graph.createBestPath(txc);
    } else {
        //群組全體結帳的狀況
        await Debt.deleteGroupDebts(conn, gid);
        await Debt.deleteDebtBalance(conn, req.params.id);
        await Graph.deleteBestPath(txc, req.params.id);
    }
};
const deleteDebt = async (req, res) => {
    const debtId = req.body.debt_id;
    const debtMain = req.body.debt_main; //{gid, debt_date, title, total, lender, split_method}
    const debtDetail = req.body.debt_detail; //{ [ { borrower, amount} ] }

    debtDetail.forEach((ele, ind) => {
        debtDetail[ind].amount = -ele.amount;
    });
    console.log('parmas for query:  ', debtId, debtMain, debtDetail);

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const session = driver.session();

    try {
        const status = 0; //customer delete
        //mysql set debt status to 0
        const deleteResult = await Debt.deleteDebt(conn, debtId, status);
        if (!deleteResult) {
            throw new Error('Internal Server Error');
        }
        //mysql update balance
        const updateBalanceResult = await updateBalance(conn, debtMain, debtDetail);
        if (!updateBalanceResult) {
            throw new Error('Internal Server Error');
        }
        //Neo4j update edge
        const updateGraphEdgeesult = await updateGraphEdge(session, debtMain, debtDetail);
        console.log('Neo4j更新線的結果：', updateGraphEdgeesult);
        const [graph, debtsForUpdate] = await getBestPath(session, debtMain.gid);
        if (!debtsForUpdate) {
            throw new Error('Internal Server Error');
        }

        //NEO4j更新best path graph
        const updateGraph = Graph.updateBestPath(debtsForUpdate);
        if (!updateGraph) {
            throw new Error('Internal Server Error');
        }
        res.status(200).json({ data: graph });

        await conn.commit();
        await session.close();
    } catch (err) {
        console.log('error: ', err);
        await conn.rollback();
        return res.status(500).json({ err });
    } finally {
        await conn.release();
    }
};

const createBatchBalance = async (req, res) => {
    //批次建立建立member balance, 暫時沒用到
    //整理members的排列組合
    let memberCombo = [];
    for (let i = 0; i < members.length; i++) {
        for (let j = 0; j < members.length - 1; j++) {
            let x = i + j + 1;
            if (x > members.length - 1) {
                break;
            }
            memberCombo.push([members[i], members[x]]);
        }
    }
    console.log(memberCombo);
    const balanceResult = await Admin.createBatchBalance(groupId, memberCombo, conn);
    if (!balanceResult) {
        return res.status(500).json({ err: 'Internal Server Error' });
    }
};

//function 區
const updateBalance = async (conn, debtMain, debtDetail) => {
    try {
        //拉出pair本來的借貸並更新
        for (let debt of debtDetail) {
            // 原本是本次的borrower-own->lender
            const getBalanceResult = await Debt.getBalance(conn, debtMain.gid, debt.borrower, debtMain.lender);
            if (!getBalanceResult) {
                throw new Error('Internal Server Error');
            }
            if (getBalanceResult.length !== 0) {
                let balanceId = getBalanceResult[0].id;
                let originalDebt = getBalanceResult[0].amount;
                let newBalance = originalDebt + debt.amount; //add more debt
                const result = await Debt.updateBalance(conn, balanceId, debt.borrower, debtMain.lender, newBalance);

                if (!result) {
                    throw new Error('Internal Server Error');
                }
            } else {
                //原本是本次的borrower <-own-lender
                const getBalanceResult = await Debt.getBalance(conn, debtMain.gid, debtMain.lender, debt.borrower);
                if (!getBalanceResult) {
                    throw new Error('Internal Server Error');
                }
                if (getBalanceResult.length !== 0) {
                    let balanceId = getBalanceResult[0].id;
                    let originalDebt = getBalanceResult[0].amount;
                    let newBalance = originalDebt - debt.amount; //pay back
                    if (newBalance > 0) {
                        //  維持borrower <-own-lender
                        const result = await Debt.updateBalance(conn, balanceId, debtMain.lender, debt.borrower, newBalance);
                        if (!result) {
                            throw new Error('Internal Server Error');
                        }
                    } else {
                        // 改為borrower-own->lender
                        const result = await Debt.updateBalance(conn, balanceId, debt.borrower, debtMain.lender, -newBalance);
                        if (!result) {
                            throw new Error('Internal Server Error');
                        }
                    }
                    //都沒查到，新增一筆
                } else {
                    const result = await Debt.createBalance(conn, debtMain.gid, debt.borrower, debtMain.lender, debt.amount);
                    if (!result) {
                        throw new Error('Internal Server Error');
                    }
                }
            }
        }
        return true;
    } catch (err) {
        console.log(err);
    }
};
const updateGraphEdge = async (session, debtMain, debtDetail) => {
    try {
        neo4j.int(10);
        let borrowers = [];
        for (let debt of debtDetail) {
            if (debt.borrower !== debtMain.lender) {
                borrowers.push(debt);
            }
        }
        console.log('for Neo:   ', debtMain, borrowers);
        const updateGraphEdgeesult = await Graph.updateEdge(session, debtMain, borrowers);
        return updateGraphEdgeesult;
    } catch (err) {
        console.log(err);
        return false;
    }
};

const getBestPath = async (session, group) => {
    try {
        console.time('all');
        const graph = {};
        const allNodeList = [];
        const pathsStructure = {};
        const order = [];
        // console.log('search group:', group);

        // 1) Neo4j get all path
        try {
            // 1-1) 查詢圖中所有node
            console.time('db1');
            const allNodesResult = await Graph.allNodes(session, group);
            console.timeEnd('db1');
            allNodesResult.records.forEach((element) => {
                let name = element.get('name').toNumber();
                graph[name] = {};
                allNodeList.push(name);
            });
            // console.log('allNodeList: ', allNodeList);

            // 1-2) 查每個source出去的edge數量
            for (let source of allNodeList) {
                console.time('db2');
                const sourceEdgeResult = await Graph.sourceEdge(session, source, group);
                console.timeEnd('db2');
                pathsStructure[source] = { sinksSummary: { sinks: [], qty: 0 }, sinks: {} };
                pathsStructure[source].sinksSummary.qty = sourceEdgeResult.records.length; //紀錄qty
                sourceEdgeResult.records.forEach((element, index) => {
                    pathsStructure[source].sinksSummary.sinks.push(element.get('name').toNumber());
                });
                order.push({ source: source, qty: pathsStructure[source].sinksSummary.qty }); //同步放進order的列表中
            }
            order.sort((a, b) => {
                return b.qty - a.qty; //排序列表供後面決定順序用
            });
        } catch (err) {
            console.log('ERROR AT getBestPath Neo4j Search: ', err);
            return false;
        }
        // console.log('order:', order);

        //第一層：iterate sources
        for (let source of order) {
            // console.log('source: ', source.source);
            let currentSource = source.source; //當前的source
            console.time('db3');
            // 1-3) 查所有的路徑
            const pathsResult = await Graph.allPaths(session, currentSource, group);
            // console.log(pathsResult);
            console.timeEnd('db3');
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
                    console.log('edge from neo:  ', 'start:', edge.start.properties.name, 'r: ', edge.relationship.properties.amount, 'end:', edge.end.properties.name);
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
        // console.log('最終存好的graph: ', graph);

        // 3) calculate best path
        console.time('split');
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
                    // console.log('目前path', path);
                    let bottleneckValue = 0;
                    let pathBlock = false;
                    if (path.length !== 1) {
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
                            debtsForUpdate.push({ borrowerId: edge[0], lenderId: edge[1], adjust: -bottleneckValue });
                        });
                        //找出瓶頸edge的索引號碼
                        bottleneckIndex = debts.indexOf(bottleneckValue); //FIXME:好像沒用到
                        // 3-3) 將流量先暫加到totalFlow
                        totalFlow += bottleneckValue;
                        // console.log('累積ttlflow:', totalFlow);
                        // console.log('扣除後：', graph);
                    }
                }
                // 3-4) 將totalFlow加到最短的邊上
                if (totalFlow) {
                    // console.log('總ttlflow:', totalFlow);
                    graph[source.source][sink] += totalFlow;
                    debtsForUpdate.push({ borrowerId: source.source, lenderId: sink, adjust: totalFlow });
                    // console.log('加流量：', graph);
                }
            });
        }
        console.timeEnd('split');
        console.log(graph);
        console.timeEnd('all');
        return [graph, debtsForUpdate];
    } catch (err) {
        console.log('ERROR AT getBestPath: ', err);
        return false;
    }
};
// getBestPath();
module.exports = { getBestPath };

module.exports = { getDebtMain, getDebtDetail, getDebtDetail, getMeberBalances, getSettle, postDebt, deleteDebt };
