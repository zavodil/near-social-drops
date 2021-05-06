import 'regenerator-runtime/runtime'
import React from 'react'
import {login, logout} from './utils'
import * as nearAPI from 'near-api-js'

const queryString = require('query-string');
import Dropdown from 'react-dropdown';
import 'react-dropdown/style.css';
import './global.css'
import './app.css'
import {useDetectOutsideClick} from "./includes/useDetectOutsideClick";
import {Header, Footer, Notification} from "./includes/pageParts";
import * as nearFunctions from "/includes/nearFunctions";

import getConfig from './config'
import getAppSettings from './app-settings'

const appSettings = getAppSettings();
const config = getConfig(process.env.NODE_ENV || 'development');
const FRAC_DIGITS = 5;

export default function App() {
    const [buttonDisabled, setButtonDisabled] = React.useState(false)
    const [showNotification, setShowNotification] = React.useState(false)
    const navDropdownRef = React.useRef(null);
    const [isNavDropdownActive, setIsNaVDropdownActive] = useDetectOutsideClick(navDropdownRef, false);

    /* APP STATE */
    const [input, setInput] = React.useState("");
    const [allDrops, setAllDrops] = React.useState("");
    const [deposit, setDeposit] = React.useState(0);
    const [contactType, setContactType] = React.useState("Github");
    const [contactValue, setContactValue] = React.useState("");
    const [contactAmount, setContactAmount] = React.useState("");
    const [payouts, setPayouts] = React.useState([]);
    const [dropTitle, setDropTitle] = React.useState("");
    const [githubRepo, setGithubRepo] = React.useState("");
    const [githubRepoAmount, setGithubRepoAmount] = React.useState(0);
    const [selectedDrop, setSelectedDrop] = React.useState(-1);

    const [txProcessing, setTxProcessing] = React.useState(false);

    const [userContacts, setUserContacts] = React.useState([]);

    /* APP */
    const inputChange = (value) => {
        setInput(value);
        setButtonDisabled(!parseFloat(value) || parseFloat(value) < 0);
    };

    const dropdownOptions = ["Github", "Telegram", "Email"];

    /* ON LOAD EVENT */
    const OnSignIn = async () => {
        try {
            const drops = await LoadAllDrops();
            await LoadContacts();

            return drops;
        } catch (e) {
            Notify({method: "fail", data: e.message});
        }
    };

    const LoadAllDrops = async () => {
        const drops = await window.contract.get_drops({
            from_index: 0,
            limit: 100
        });

        setAllDrops(drops);

        return drops;
    };

    const LoadContacts = async () => {
        const contacts = await window.authContract.get_contacts({
            account_id: window.accountId
        });
        setUserContacts(contacts || []);

    };

    /* UI EVENTS */
    const NavMenuOnClick = () => setIsNaVDropdownActive(!isNavDropdownActive);

    const Notify = (params) => {
        setShowNotification(params);
        setTimeout(() => {
            setShowNotification(false)
        }, 11000)
    };

    React.useEffect(
        async () => {
            if (window.walletConnection.isSignedIn()) {
                await OnSignIn();

                if (location.search) {
                    const query = JSON.parse(JSON.stringify(queryString.parse(location.search)));
                    if (query && query.hasOwnProperty("drop")) {
                        setSelectedDrop(query.drop)
                    }
                }
            }
        },
        []
    );

    /* LOGIN SCREEN */
    if (!window.walletConnection.isSignedIn()) {

        return (
            <>
                <Header onClick={NavMenuOnClick}
                        config={config}
                        deposit={deposit}
                        navDropdownRef={navDropdownRef}
                        isNavDropdownActive={isNavDropdownActive}
                        appSettings={appSettings}/>
                <main>
                    <h1>{appSettings.appFullNme}</h1>
                    <p>
                        {appSettings.appDescription}
                    </p>
                    <p>
                        To make use of the NEAR blockchain, you need to sign in. The button
                        below will sign you in using NEAR Wallet.
                    </p>
                    <p style={{textAlign: 'center', marginTop: '2.5em'}}>
                        <button onClick={login}>Sign in</button>
                    </p>
                </main>
                <Footer appSettings={appSettings}/>
            </>
        )
    }

    const addPayout = (payout) => {
        setPayouts([...payouts, payout]);
        setContactValue("");
    };

    const PayoutsList = () => {
        return (<ul>
            {Object.keys(payouts).map((key, index) => {
                const payout = payouts[index];
                return <li
                    key={`payout-${index}`}>{payout.contact.value} / {payout.contact.category}: {payout.amount}Ⓝ</li>
            })}
        </ul>);
    };

    const ClaimDropButton = (props) => {
        return <button className="claim-drop" disabled={!props.claim_available}
                       onClick={async event => {
                           event.preventDefault()
                           setTxProcessing(true);

                           try {
                               await window.contract.claim({
                                   drop_id: Number(props.drop_id),
                                   contact: {
                                       category: props.category,
                                       value: props.value
                                   }
                               }, 300000000000000, 0);
                               Notify({method: "call", data: "claim"});
                           } catch (e) {
                               nearFunctions.ContractCallAlert();
                               Notify({method: "fail", data: e.message});
                               throw e
                           } finally {
                               setTxProcessing(false)
                               await LoadAllDrops();
                           }

                       }}>
            Claim {props.amount} Ⓝ
        </button>;
    };

    const SelectedDrop = () => {
        if (Number(selectedDrop) < 0) {
            return null;
        } else {
            const drop = allDrops[selectedDrop];
            return <div><h3>My Drops</h3>
                <div>
                    Drop #{selectedDrop}: {drop.tite}
                </div>
                <ul>
                    {Object.keys(drop.payouts).map((key, index) => {
                        const payout = drop.payouts[index];
                        const amountNear = nearAPI.utils.format.formatNearAmount(payout.amount, FRAC_DIGITS).replace(",", "");
                        let claim_available = false;


                        for (let i = 0; i < userContacts.length; i++) {
                            const contact = userContacts[i];
                            if (contact.value === payout.contact.value && contact.category === payout.contact.category) {
                                claim_available = !txProcessing;
                                break;
                            }
                        }

                        return <li
                            key={`payout-${index}`}>
                            {payout.contact.value} / {payout.contact.category}
                            {!payout.claimed ?
                                <ClaimDropButton claim_available={claim_available} drop_id={selectedDrop}
                                                 category={payout.contact.category}
                                                 value={payout.contact.value}
                                                 amount={amountNear}/>
                                : <button className="claim-drop" disabled={true}>
                                    {amountNear} Ⓝ Already claimed
                                </button>}
                        </li>
                    })}
                </ul>
            </div>;
        }
    };

    const MyDropsList = () => {
        if(Object.keys(allDrops).length) {
            const myDropsKeys = Object.keys(allDrops).filter(key => allDrops[key].owner_account_id === window.accountId);
            return (
                !!Object.keys(myDropsKeys).length &&
                <div><h3>My Drops</h3>
                    <ul>
                        {myDropsKeys.map((key) => {
                            const drop = allDrops[key];
                            return <li
                                key={`drop-${key}`}>
                                <a href={`/?drop=${key}`}>
                                    {drop.title || "[No title]"}
                                </a>
                            </li>
                        })}
                    </ul>
                </div>);
        }
        else
            return null;
    };

    const SubmitPayoutsButton = () => {
        return (
            !!Object.keys(payouts).length &&
            <button
                disabled={buttonDisabled}
                onClick={async event => {
                    event.preventDefault()

                    if (payouts.length) {
                        try {
                            let total = 0;
                            let exportPayouts = [];
                            {
                                Object.keys(payouts).map((key, index) => {
                                    total += parseFloat(payouts[index].amount);
                                    exportPayouts.push({
                                        amount: nearFunctions.ConvertToYoctoNear(payouts[index].amount),
                                        contact: payouts[index].contact
                                    });
                                })
                            }

                            await window.contract.add_drop({
                                payouts: exportPayouts,
                                title: dropTitle,
                                description: "",
                            }, 300000000000000, nearFunctions.ConvertToYoctoNear(total))
                        } catch (e) {
                            nearFunctions.ContractCallAlert();
                            Notify({method: "fail", data: e.message});
                            throw e
                        } finally {
                            fieldset.disabled = false
                        }

                        Notify({method: "call", data: "send"});
                    }
                }}
            >
                Create a drop
            </button>
        )
    }


    return (
        <>
            <Header onClick={NavMenuOnClick}
                    config={config}
                    deposit={deposit}
                    navDropdownRef={navDropdownRef}
                    isNavDropdownActive={isNavDropdownActive}
                    appSettings={appSettings}/>
            <main>
                <div className="background-img"/>
                <h1>
                    <a href={"/"}>
                        {appSettings.appFullNme}
                    </a>
                </h1>

                <form onSubmit={async event => {
                    event.preventDefault()

                    const {fieldset} = event.target.elements;

                    if (contactAmount && contactValue && contactType) {
                        let contact = {
                            amount: contactAmount,
                            contact: {
                                category: contactType,
                                value: contactValue
                            }
                        }
                        addPayout(contact);
                    }

                    if (input) {
                        fieldset.disabled = true

                        try {
                            await window.contract.send({}, 300000000000000, nearFunctions.ConvertToYoctoNear(1))
                        } catch (e) {
                            nearFunctions.ContractCallAlert();
                            Notify({method: "fail", data: e.message});
                            throw e
                        } finally {
                            fieldset.disabled = false
                        }

                        Notify({method: "call", data: "send"});
                    }
                }}>
                    <fieldset id="fieldset">
                        <div style={{display: 'flex'}}>
                            <div style={{paddingTop: "18px"}}>
                                <label
                                    htmlFor="input-drop-title"
                                    style={{
                                        display: 'block',
                                        color: 'var(--gray)',
                                        marginBottom: '0.5em'
                                    }}
                                >
                                    Create Social Drop
                                </label>
                            </div>
                            <div style={{paddingTop: "10px", paddingBottom: "10px", paddingLeft: "20px"}}>
                                <input
                                    key="input-drop-title"
                                    autoComplete="off"
                                    value={dropTitle}
                                    placeholder="Drop Title"
                                    id="input-drop-title"
                                    onChange={e => setDropTitle(e.target.value)}
                                    style={{flex: 1}}
                                />
                            </div>
                        </div>
                        <div style={{display: 'flex'}}>
                            <Dropdown
                                style={{minWidth: "150px"}}
                                options={dropdownOptions}
                                onChange={e => setContactType(e.value)}
                                value={contactType}
                                placeholder="Type"/>

                            <input
                                key="input-contact-value"
                                autoComplete="off"
                                value={contactValue}
                                placeholder="Handle"
                                id="contact-value"
                                onChange={e => setContactValue(e.target.value)}
                                style={{flex: 1}}
                            />

                            <input
                                key="input-contact-amount"
                                autoComplete="off"
                                value={contactAmount}
                                id="contact-amount"
                                placeholder="Amount"
                                onChange={e => setContactAmount(e.target.value)}
                                style={{flex: 1}}
                            />

                            <button
                                disabled={buttonDisabled}
                                style={{borderRadius: '0 5px 5px 0'}}
                            >
                                Add
                            </button>
                        </div>
                    </fieldset>
                </form>

                <PayoutsList/>

                <SubmitPayoutsButton/>


                <form onSubmit={async event => {
                    event.preventDefault()

                    const {fieldset} = event.target.elements;

                    if (input) {
                        fieldset.disabled = true

                        try {
                            await window.contract.send({}, 300000000000000, nearFunctions.ConvertToYoctoNear(1))
                        } catch (e) {
                            nearFunctions.ContractCallAlert();
                            Notify({method: "fail", data: e.message});
                            throw e
                        } finally {
                            fieldset.disabled = false
                        }

                        Notify({method: "call", data: "send"});
                    }
                }}>
                    <fieldset id="fieldset" style={{paddingTop: "30px"}}>
                        <label
                            htmlFor="github-repo"
                            style={{
                                display: 'block',
                                color: 'var(--gray)',
                                marginBottom: '0.5em'
                            }}
                        >
                            Import Github Contributors:
                        </label>
                        <div style={{display: 'flex'}}>
                            <input
                                key="input-github-repo"
                                title="Github Repo"
                                autoComplete="off"
                                value={githubRepo}
                                id="github-repo"
                                onChange={e => setGithubRepo(e.target.value)}
                                placeholder="Github Repo"
                                style={{flex: 1}}
                            />

                            <input
                                key="input-github-repo-amount"
                                autoComplete="off"
                                value={githubRepoAmount}
                                id="contact-amount"
                                placeholder="Amount"
                                onChange={e => setGithubRepoAmount(e.target.value)}
                                style={{flex: 1}}
                            />

                            <button
                                disabled={buttonDisabled}
                                style={{borderRadius: '0 5px 5px 0'}}
                                title={"Import Github Contributors"}
                                onClick={async event => {
                                    event.preventDefault()

                                    const url = `https://api.github.com/repos/${githubRepo}/contributors?anon=1`;
                                    let exportPayouts = [];

                                    fetch(url)
                                        .then(response => response.json())
                                        .then(data => {
                                            if (!data.length)
                                                alert("Contributors not found");
                                            data.forEach((item) => {
                                                if (item.hasOwnProperty("login")) {
                                                    exportPayouts.push({
                                                        amount: githubRepoAmount,
                                                        contact: {
                                                            category: "Github",
                                                            value: item["login"]
                                                        }
                                                    });
                                                }
                                            })

                                            setPayouts(exportPayouts);
                                        });

                                    if (exportPayouts.length > 0)
                                        Notify({method: "text", data: `${exportPayouts} github users found`});
                                }}
                            >
                                Import
                            </button>
                        </div>
                    </fieldset>
                </form>

                <SelectedDrop/>

                <div className={"hints"}>
                    <MyDropsList/>
                </div>
            </main>
            <Footer appSettings={appSettings}/>
            {showNotification && Object.keys(showNotification) &&
            <Notification config={config} method={showNotification.method} data={showNotification.data}/>}
        </>
    );
}